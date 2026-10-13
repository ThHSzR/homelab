const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { performance } = require('node:perf_hooks');

function varint(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}
function readVarint(buffer, offset = 0) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buffer.length) return null;
    const byte = buffer[offset + i];
    value |= (byte & 0x7f) << (i * 7);
    if (!(byte & 0x80)) return { value: value >>> 0, next: offset + i + 1 };
  }
  throw new Error('VarInt inválido');
}
function packet(payload) { return Buffer.concat([varint(payload.length), payload]); }
function pingMinecraft(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let connected = false, done = false, buffer = Buffer.alloc(0);
    const deadline = setTimeout(() => finish({ status: connected ? 'possible' : 'offline', detail: 'Tempo esgotado' }), 3000);
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve(value);
    }
    socket.once('connect', () => {
      connected = true;
      const host = Buffer.from('localhost');
      const handshake = Buffer.concat([varint(0), varint(760), varint(host.length), host,
        Buffer.from([port >> 8, port & 255]), varint(1)]);
      socket.write(Buffer.concat([packet(handshake), packet(varint(0))]));
    });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 65536) return finish({ status: 'possible', detail: 'Resposta acima do limite' });
      try {
        const frame = readVarint(buffer);
        if (!frame || buffer.length < frame.next + frame.value) return;
        const id = readVarint(buffer, frame.next);
        const size = id && readVarint(buffer, id.next);
        if (!id || id.value !== 0 || !size || size.value > 60000 || size.next + size.value > frame.next + frame.value)
          throw new Error('Resposta inesperada');
        const info = JSON.parse(buffer.subarray(size.next, size.next + size.value).toString('utf8'));
        if (!info.version && !info.players) throw new Error('Status incompleto');
        finish({ status: 'online', detail: 'Status Minecraft confirmado',
          version: typeof info.version?.name === 'string' ? info.version.name.slice(0, 80) : null,
          players: Number.isInteger(info.players?.online) ? info.players.online : null,
          maxPlayers: Number.isInteger(info.players?.max) ? info.players.max : null });
      } catch { finish({ status: 'possible', detail: 'Porta aberta; resposta Minecraft não confirmada' }); }
    });
    socket.once('error', () => finish({ status: connected ? 'possible' : 'offline', detail: 'Sem resposta na porta' }));
    socket.once('close', () => finish({ status: connected ? 'possible' : 'offline', detail: 'Conexão encerrada sem status' }));
  });
}
function javaJar(commandLine) {
  const args = commandLine.toString('utf8').split('\0').filter(Boolean);
  if (!/(?:^|\/)java(?:$|\d+$)/.test(args[0] || '')) return null;
  const jarIndex = args.indexOf('-jar');
  if (jarIndex >= 0 && args[jarIndex + 1]) return path.basename(args[jarIndex + 1]);
  return args.some(arg => /net\.minecraft\.server|fabric\.installer|forge\.server/i.test(arg)) ? 'Servidor Java' : null;
}
function processTicks(stat) {
  const end = stat.lastIndexOf(')');
  if (end < 0) return null;
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  const ticks = Number(fields[11]) + Number(fields[12]);
  const start = Number(fields[19]);
  return fields.length >= 20 && Number.isFinite(ticks) && ticks >= 0 && Number.isFinite(start) && start >= 0 ? { ticks, start } : null;
}
function systemTicks(stat) {
  const row = stat.split('\n')[0]?.split(/\s+/).slice(1).map(Number);
  return row?.length >= 4 && row.every(Number.isFinite) ? row.reduce((a, b) => a + b, 0) : null;
}
async function pm2MinecraftMetrics({ run = require('./collectors').command,
  home = os.homedir() } = {}) {
  const cli = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'lib/node_modules/pm2/bin/pm2');
  const result = await run(process.execPath, [cli, 'jlist']);
  if (!result.ok) return null;
  let list;
  try { list = JSON.parse(result.text); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const matches = list.filter(p => p.name === 'minecraft' && p.pm2_env?.status === 'online' &&
    p.pm2_env?.pm_exec_path === path.join(home, 'minecraft/start.sh') &&
    Number.isInteger(p.pid) && p.pid > 0);
  if (matches.length !== 1) return null;
  const { pid, monit = {} } = matches[0];
  return { pid, cpuPercent: Number.isFinite(monit.cpu) && monit.cpu >= 0 && monit.cpu <= 10000 ? monit.cpu : null,
    rssBytes: Number.isFinite(monit.memory) && monit.memory >= 0 ? monit.memory : null };
}
function createMinecraftProbe({ procRoot = '/proc', port = Number(process.env.MINECRAFT_PORT || 25565),
  ping = pingMinecraft, totalMemory = os.totalmem, now = () => performance.now(),
  readFile = fs.readFile,
  pm2Metrics = pm2MinecraftMetrics,
  clockTicks = async () => {
    const result = await require('./collectors').command('getconf', ['CLK_TCK'], 2);
    return result.ok ? Number(result.text) : null;
  } } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MINECRAFT_PORT inválida');
  let prior = null, hz = null;
  return async function probe() {
    const network = await ping(port);
    let entries, procError = null;
    try { entries = (await fs.readdir(procRoot)).filter(name => /^\d+$/.test(name)); }
    catch (error) { entries = []; procError = error.code || 'desconhecido'; }
    const candidates = [];
    let denied = false, invalid = false;
    // Batch reads to avoid flooding /proc on the phone.
    for (let i = 0; i < entries.length; i += 24) {
      const batch = await Promise.all(entries.slice(i, i + 24).map(async pid => {
        try {
          const jar = javaJar(await readFile(path.join(procRoot, pid, 'cmdline')));
          if (!jar) return null;
          const [stat, status] = await Promise.all([
            readFile(path.join(procRoot, pid, 'stat'), 'utf8'),
            readFile(path.join(procRoot, pid, 'status'), 'utf8').catch(() => '')
          ]);
          const cpu = processTicks(stat);
          if (!cpu) invalid = true;
          const rss = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
          return cpu && { pid: Number(pid), jar, ...cpu, sampledAt: now(), rssBytes: rss ? Number(rss[1]) * 1024 : null };
        } catch (error) { if (['EACCES', 'EPERM'].includes(error.code)) denied = true; return null; }
      }));
      candidates.push(...batch.filter(Boolean));
    }
    const named = candidates.filter(item => /minecraft|server|paper|purpur|spigot|fabric|forge|neoforge|velocity/i.test(item.jar));
    const selected = named.length === 1 ? named[0] : null;
    if (hz == null) {
      try { const value = await clockTicks(); if (Number.isFinite(value) && value > 0) hz = value; } catch {}
    }
    let process = null;
    let cpuReason = named.length > 1 ? 'Vários processos Java compatíveis; PID ambíguo.' :
      invalid ? 'Stat do processo Java inválido.' : denied ? 'Processo Java não identificado; procfs restringiu a leitura (EACCES/EPERM).' :
        procError ? 'Listagem /proc indisponível (' + procError + ').' : 'Processo Minecraft não identificado.';
    if (selected) {
      let cpuPercent = null;
      cpuReason = hz == null ? 'getconf CLK_TCK indisponível; taxa de CPU não pode ser calculada.' :
        !prior ? 'Primeira amostra; próxima medição em até 30 s.' :
        prior.pid !== selected.pid || prior.start !== selected.start ? 'Processo reiniciado; coletando nova base de CPU.' :
        selected.sampledAt <= prior.sampledAt ? 'Intervalo entre amostras inválido.' :
        selected.ticks < prior.ticks ? 'Contador de CPU retrocedeu; coletando nova base.' : null;
      if (!cpuReason) cpuPercent = Math.round((selected.ticks - prior.ticks) / hz / ((selected.sampledAt - prior.sampledAt) / 1000) * 1000) / 10;
      process = { pid: selected.pid, jar: selected.jar, rssBytes: selected.rssBytes,
        cpuPercent, cpuReason, cpuMethod: 'process-ticks/monotonic-time',
        sampleIntervalMs: prior ? selected.sampledAt - prior.sampledAt : null,
        memoryPercent: selected.rssBytes == null ? null : Math.round(selected.rssBytes / totalMemory() * 1000) / 10 };
      prior = { ...selected };
    } else prior = null;
    if (!process || process.cpuPercent == null) {
      let fallback = null;
      try { fallback = await pm2Metrics(); } catch {}
      if (fallback && (!process || process.pid === fallback.pid) && fallback.cpuPercent != null) {
        process = { ...(process || { pid: fallback.pid, jar: 'Minecraft · PM2', rssBytes: fallback.rssBytes,
          memoryPercent: fallback.rssBytes == null ? null : Math.round(fallback.rssBytes / totalMemory() * 1000) / 10 }),
          cpuPercent: fallback.cpuPercent, cpuReason: null, cpuMethod: 'pm2-monitor', sampleIntervalMs: null };
        cpuReason = null;
      }
    }
    return { ...network, port, process, cpuReason, processMatch: selected ? 'named-candidate' : process ? 'pm2-registered' : null,
      candidateCount: candidates.length };
  };
}
module.exports = { pingMinecraft, createMinecraftProbe, pm2MinecraftMetrics, javaJar, processTicks, systemTicks, varint, readVarint };
