const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');

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
  return Number.isFinite(ticks) && Number.isFinite(start) ? { ticks, start } : null;
}
function systemTicks(stat) {
  const row = stat.split('\n')[0]?.split(/\s+/).slice(1).map(Number);
  return row?.length >= 4 && row.every(Number.isFinite) ? row.reduce((a, b) => a + b, 0) : null;
}
function createMinecraftProbe({ procRoot = '/proc', port = Number(process.env.MINECRAFT_PORT || 25565),
  ping = pingMinecraft, totalMemory = os.totalmem } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MINECRAFT_PORT inválida');
  let prior = null;
  return async function probe() {
    const network = await ping(port);
    let entries;
    try { entries = (await fs.readdir(procRoot)).filter(name => /^\d+$/.test(name)); }
    catch { return { ...network, port, process: null, detail: network.detail + '; processos indisponíveis' }; }
    const candidates = [];
    // Batch reads to avoid flooding /proc on the phone.
    for (let i = 0; i < entries.length; i += 24) {
      const batch = await Promise.all(entries.slice(i, i + 24).map(async pid => {
        try {
          const jar = javaJar(await fs.readFile(path.join(procRoot, pid, 'cmdline')));
          if (!jar) return null;
          const [stat, status] = await Promise.all([
            fs.readFile(path.join(procRoot, pid, 'stat'), 'utf8'),
            fs.readFile(path.join(procRoot, pid, 'status'), 'utf8')
          ]);
          const cpu = processTicks(stat);
          const rss = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
          return cpu && { pid: Number(pid), jar, ...cpu, rssBytes: rss ? Number(rss[1]) * 1024 : null };
        } catch { return null; }
      }));
      candidates.push(...batch.filter(Boolean));
    }
    const named = candidates.filter(item => /minecraft|server|paper|purpur|spigot|fabric|forge|neoforge|velocity/i.test(item.jar));
    const selected = named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : null;
    let total = null;
    try { total = systemTicks(await fs.readFile(path.join(procRoot, 'stat'), 'utf8')); } catch {}
    let process = null;
    if (selected) {
      let cpuPercent = null;
      if (prior && prior.pid === selected.pid && prior.start === selected.start && total != null && total > prior.total) {
        cpuPercent = Math.max(0, Math.round((selected.ticks - prior.ticks) / (total - prior.total) * os.cpus().length * 100));
      }
      process = { pid: selected.pid, jar: selected.jar, rssBytes: selected.rssBytes,
        cpuPercent, memoryPercent: selected.rssBytes == null ? null : Math.round(selected.rssBytes / totalMemory() * 1000) / 10 };
      prior = { pid: selected.pid, start: selected.start, ticks: selected.ticks, total };
    } else prior = null;
    return { ...network, port, process, processMatch: selected ?
      (named.length === 1 ? 'named-candidate' : 'single-java-candidate') : null,
      candidateCount: candidates.length };
  };
}
module.exports = { pingMinecraft, createMinecraftProbe, javaJar, processTicks, systemTicks, varint, readVarint };
