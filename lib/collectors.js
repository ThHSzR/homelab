const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const HOME = os.homedir();
const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
let pm2Read = null;

function command(file, args = [], seconds = 4) {
  const isPm2 = file === process.execPath && args[0]?.endsWith('/pm2/bin/pm2');
  const isList = isPm2 && args[1] === 'jlist';
  if (isList && pm2Read && Date.now() - pm2Read.at < 2000) return pm2Read.promise;
  if (isPm2 && !isList) pm2Read = null;
  const promise = new Promise(resolve => {
    // GNU timeout also bounds descendants of Termux API shell wrappers.
    execFile(process.platform === 'win32' ? file : 'timeout',
      process.platform === 'win32' ? args : ['-k', '1', String(seconds), file, ...args],
      { encoding: 'utf8', timeout: (seconds + 2) * 1000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve({ ok: !error, text: (stdout || '').trim() }));
  });
  if (isList) pm2Read = { at: Date.now(), promise };
  return promise;
}
function parseDisk(text) {
  const row = text.trim().split('\n').at(-1).trim().split(/\s+/);
  if (row.length < 6 || !/^\d+$/.test(row[1])) return null;
  return { totalBytes: +row[1] * 1024, usedBytes: +row[2] * 1024,
    availableBytes: +row[3] * 1024, percent: parseInt(row[4], 10) };
}
function tailnetAddress(interfaces) {
  for (const item of interfaces) {
    if (!item.flags?.includes('UP')) continue;
    for (const addr of item.addr_info || []) {
      const p = (addr.local || '').split('.').map(Number);
      if (addr.family === 'inet' && p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127)
        return { ip: addr.local, interface: item.ifname };
    }
  }
  return null;
}
function probe(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1200);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
function parseAdbBattery(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    if (!(key in fields)) fields[key] = line.slice(split + 1).trim();
  }
  if (fields.present !== 'true' || fields.use_fake_battery === 'true' ||
      !['level', 'scale', 'temperature', 'health', 'status'].every(key => /^-?\d+$/.test(fields[key] || ''))) return null;
  const level = +fields.level, scale = +fields.scale, temperature = +fields.temperature / 10;
  if (scale <= 0 || level < 0 || level > scale || temperature < -20 || temperature > 100) return null;
  const health = ({1:'UNKNOWN',2:'GOOD',3:'OVERHEAT',4:'DEAD',5:'OVER_VOLTAGE',6:'UNSPECIFIED_FAILURE',7:'COLD'})[+fields.health];
  if (!health) return null;
  const plugged = ['ac', 'usb', 'wireless'].some(name => fields[name + ' powered'] === 'true');
  return {available:true, percentage:level / scale * 100, temperature, health,
    status:({2:'CHARGING',3:'DISCHARGING',4:'NOT_CHARGING',5:'FULL'})[+fields.status] || 'UNKNOWN',
    plugged:plugged ? 'PLUGGED' : 'UNPLUGGED', source:'adb-dumpsys-battery'};
}
async function battery() {
  const gatewayState = path.join(HOME, '.local/share/a30-remote-gateway/device-serial');
  // Só usa o gateway em aparelhos nos quais ele já foi provisionado pelo proprietário.
  // Sem fallback nessa situação: não recriar o app de telemetria durante uma inferência.
  if (await fs.stat(gatewayState).then(state => state.isFile()).catch(() => false)) {
    const gateway = path.join(HOME, 'services/homelab/tools/a30-remote/a30-adb-gateway');
    const result = await command('bash', [gateway, 'battery'], 20);
    const value = result.ok ? parseAdbBattery(result.text) : null;
    return value || {available:false, reason:'Gateway ADB não forneceu a telemetria de bateria.'};
  }
  const installed = await command('/system/bin/pm', ['path', 'com.termux.api'], 2);
  if (!installed.ok || !installed.text.includes('package:'))
    return { available: false, reason: 'Instale e abra o app Termux:API da mesma origem do Termux.' };
  // Termux:API can take a few seconds to return while Android wakes the app in background.
  // A longer timeout avoids killing the caller before ResultReturner writes back to its local socket.
  const result = await command('termux-battery-status', [], 10);
  try {
    const value = JSON.parse(result.text);
    if (!result.ok || typeof value.percentage !== 'number') throw new Error();
    return { available: true, percentage: value.percentage, temperature: value.temperature,
      status: value.status, plugged: value.plugged, health: value.health };
  } catch { return { available: false, reason: 'Termux:API não respondeu dentro do prazo.' }; }
}
function parseProcesses(text, now = Date.now()) {
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return null;
    const metric = value => Number.isFinite(value) && value >= 0 ? value : null;
    return list.map(p => ({ name: p.name,
      state: p.pm2_env?.status || 'unknown', restarts: metric(p.pm2_env?.restart_time),
      uptimeSeconds: p.pm2_env?.status === 'online'
        ? metric(p.pm2_env.pm_uptime) == null ? null : Math.max(0, Math.floor((now - p.pm2_env.pm_uptime) / 1000)) : 0,
      memoryBytes: metric(p.monit?.memory), cpu: metric(p.monit?.cpu) }));
  } catch { return null; }
}
async function collect() {
  // Loaded at collection time to avoid circular startup imports with the command runner.
  const systemTelemetry = Promise.resolve().then(() => require('./system-telemetry').readSystemTelemetry())
    .catch(() => null);
  const [disk, power, interfaces, pm2, runit, ssh, boot, bootId, system] = await Promise.all([
    command('df', ['-Pk', HOME]), battery(), command('ip', ['-j', 'addr']),
    command(process.execPath, [path.join(PREFIX, 'lib/node_modules/pm2/bin/pm2'), 'jlist']), command('sv', ['status', path.join(PREFIX, 'var/service/bom-dia')]),
    probe(8022), fs.readFile(path.join(HOME, 'services/state/boot.json'), 'utf8').catch(() => null),
    fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => null),
    systemTelemetry
  ]);
  let tunnel = null;
  try { tunnel = tailnetAddress(JSON.parse(interfaces.text)); } catch {}
  const processes = pm2.ok ? parseProcesses(pm2.text) : null;
  let bootState = null;
  try { bootState = JSON.parse(boot); } catch {}
  const current = processes?.find(p => p.name === 'homelab-status');
  const bomDia = processes?.find(p => p.name === 'bom-dia');
  return {
    timestamp: new Date().toISOString(), hostname: os.hostname(), platform: os.platform(),
    uptimeSeconds: os.uptime(), appUptimeSeconds: process.uptime(),
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    disk: disk.ok ? parseDisk(disk.text) : null, battery: power, system,
    tailscale: { detected: interfaces.ok ? !!tunnel : null, ...tunnel, peerConnectivity: 'unverified',
      note: 'Interface local detectada não confirma acesso entre dispositivos.' },
    processes, services: [
      { id: 'homelab-status', name: 'Central TH HomeLab', state: current?.state || (processes ? 'unmanaged' : 'unknown'), port: 3000, manager: 'PM2', description: 'Painel e API de monitoramento' },
      { id: 'sshd', name: 'Acesso SSH', state: ssh ? 'online' : 'offline', port: 8022, manager: 'Termux', description: 'Conexão local testada' },
      { id: 'bom-dia', name: 'Bom Dia', state: process.env.BOM_DIA_MANAGER === 'pm2' ? (bomDia?.state || 'unknown') : runit.text.startsWith('run:') ? 'online' : runit.text.startsWith('down:') ? 'stopped' : 'unknown', manager: process.env.BOM_DIA_MANAGER === 'pm2' ? 'PM2' : 'runit', description: 'Serviço existente em ~/bom-dia' }
    ],
    persistence: { lastRun: bootState, currentBootId: bootId?.trim() || null,
      bootScriptRanThisBoot: !!(bootState && bootState.bootId === bootId?.trim() && bootState.source === 'termux-boot') }
  };
}
module.exports = { collect, command, parseDisk, parseProcesses, parseAdbBattery, tailnetAddress, probe };
