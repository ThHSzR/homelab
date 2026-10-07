const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const HOME = os.homedir();
const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';

function command(file, args = [], seconds = 4) {
  return new Promise(resolve => {
    // GNU timeout also bounds descendants of Termux API shell wrappers.
    execFile(process.platform === 'win32' ? file : 'timeout',
      process.platform === 'win32' ? args : ['-k', '1', String(seconds), file, ...args],
      { encoding: 'utf8', timeout: (seconds + 2) * 1000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve({ ok: !error, text: (stdout || '').trim() }));
  });
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
async function battery() {
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
async function collect() {
  const [disk, power, interfaces, pm2, runit, ssh, boot, bootId] = await Promise.all([
    command('df', ['-Pk', HOME]), battery(), command('ip', ['-j', 'addr']),
    command(process.execPath, [path.join(PREFIX, 'lib/node_modules/pm2/bin/pm2'), 'jlist']), command('sv', ['status', path.join(PREFIX, 'var/service/bom-dia')]),
    probe(8022), fs.readFile(path.join(HOME, 'services/state/boot.json'), 'utf8').catch(() => null),
    fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => null)
  ]);
  let tunnel = null;
  try { tunnel = tailnetAddress(JSON.parse(interfaces.text)); } catch {}
  let processes = null;
  try { if (pm2.ok) processes = JSON.parse(pm2.text).map(p => ({ name: p.name,
    state: p.pm2_env.status, restarts: p.pm2_env.restart_time,
    uptimeSeconds: p.pm2_env.status === 'online' ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0,
    memoryBytes: p.monit?.memory || 0, cpu: p.monit?.cpu || 0 })); } catch {}
  let bootState = null;
  try { bootState = JSON.parse(boot); } catch {}
  const current = processes?.find(p => p.name === 'homelab-status');
  return {
    timestamp: new Date().toISOString(), hostname: os.hostname(), platform: os.platform(),
    uptimeSeconds: os.uptime(), appUptimeSeconds: process.uptime(),
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    disk: disk.ok ? parseDisk(disk.text) : null, battery: power,
    tailscale: { detected: !!tunnel, ...tunnel, peerConnectivity: 'unverified',
      note: 'Interface local detectada não confirma acesso entre dispositivos.' },
    processes, services: [
      { id: 'homelab-status', name: 'Central TH HomeLab', state: current?.state || (processes ? 'unmanaged' : 'unknown'), port: 3000, manager: 'PM2', description: 'Painel e API de monitoramento' },
      { id: 'sshd', name: 'Acesso SSH', state: ssh ? 'online' : 'offline', port: 8022, manager: 'Termux', description: 'Conexão local testada' },
      { id: 'bom-dia', name: 'Bom Dia', state: runit.text.startsWith('run:') ? 'online' : runit.text.startsWith('down:') ? 'stopped' : 'unknown', manager: 'runit', description: 'Serviço existente em ~/bom-dia' }
    ],
    persistence: { lastRun: bootState, currentBootId: bootId?.trim() || null,
      bootScriptRanThisBoot: !!(bootState && bootState.bootId === bootId?.trim() && bootState.source === 'termux-boot') }
  };
}
module.exports = { collect, command, parseDisk, tailnetAddress, probe };
