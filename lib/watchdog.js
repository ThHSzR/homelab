const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { performance } = require('node:perf_hooks');
const { command } = require('./collectors');
const { createMinecraftProbe } = require('./minecraft');
const stateDir = process.env.WATCHDOG_STATE_DIR || path.join(os.homedir(), 'services/state');
const serviceDir = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'var/service/bom-dia');
const INTERVAL = 30000;
const COOLDOWN = 10 * 60 * 1000;
const LIMIT = 3;
const HISTORY = 120;
const minecraftProbe = createMinecraftProbe();

async function httpProbe(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
  await response.body?.cancel();
  return { status: response.ok ? 'online' : 'offline', detail: `HTTP ${response.status}` };
}
function tcpProbe(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = status => { socket.destroy(); resolve({ status }); };
    socket.setTimeout(4000);
    socket.once('connect', () => finish('online'));
    socket.once('error', () => finish('offline'));
    socket.once('timeout', () => finish('offline'));
  });
}
async function runitProbe() {
  const result = await command('sv', ['status', serviceDir]);
  if (!result.text.startsWith('run:') && !result.text.startsWith('down:'))
    return { status: 'unknown', detail: 'runit indisponível ou serviço não instalado' };
  const down = await fs.access(path.join(serviceDir, 'down')).then(() => true, () => false);
  return { status: result.text.startsWith('run:') ? 'online' : 'offline',
    recoverable: !down && result.text.startsWith('down:') && /normally up/.test(result.text),
    detail: result.text };
}
function createMonitor({ dir = stateDir, now = Date.now, enabled = process.env.WATCHDOG_RECOVER_BOM_DIA === '1',
  probes = { dashboard: () => httpProbe(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`),
    ssh: () => tcpProbe(8022), 'bom-dia': runitProbe,
    external: () => httpProbe('https://connectivitycheck.gstatic.com/generate_204'),
    minecraft: minecraftProbe },
  recover = async () => {
    const current = await runitProbe();
    if (!current.recoverable) return { ok: false };
    return command('sv', ['up', serviceDir]);
  } } = {}) {
  let snapshot = { services: {}, recovery: { attempts: 0, lastAttempt: null }, history: [] };
  let busy = false;
  let loaded = false;
  let recoveryLocked = false;
  async function save() {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'watchdog.json.tmp'), JSON.stringify(snapshot));
    await fs.rename(path.join(dir, 'watchdog.json.tmp'), path.join(dir, 'watchdog.json'));
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (!loaded) {
        try {
          const previous = JSON.parse(await fs.readFile(path.join(dir, 'watchdog.json'), 'utf8'));
          if (!previous.services || !Array.isArray(previous.history) || !Number.isInteger(previous.recovery?.attempts)
            || previous.recovery.attempts < 0
            || (previous.recovery.lastAttempt && !Number.isFinite(Date.parse(previous.recovery.lastAttempt)))) throw new Error('Estado inválido');
          snapshot = previous;
          snapshot.history = snapshot.history.slice(-HISTORY);
          recoveryLocked = !!previous.recovery.locked;
        } catch (error) { recoveryLocked = error.code !== 'ENOENT'; }
        loaded = true;
      }
      const timestamp = new Date(now()).toISOString();
      const results = await Promise.all(Object.entries(probes).map(async ([id, probe]) => {
        const start = performance.now();
        let result;
        try { result = await probe(); } catch { result = { status: 'offline', detail: 'Timeout ou falha de conexão' }; }
        const previous = snapshot.services[id];
        return [id, { ...result, latencyMs: Math.round(performance.now() - start), checkedAt: timestamp,
          lastSeen: result.status === 'online' ? timestamp : previous?.lastSeen || null,
          changedAt: previous?.status === result.status ? previous.changedAt : timestamp,
          failures: result.status === 'offline' ? (previous?.failures || 0) + 1 : 0 }];
      }));
      snapshot.services = Object.fromEntries(results);
      snapshot.timestamp = timestamp;
      snapshot.intervalMs = INTERVAL;
      snapshot.history = [...snapshot.history, { timestamp, services: snapshot.services }].slice(-HISTORY);
      snapshot.recovery.enabled = enabled;
      const bom = snapshot.services['bom-dia'];
      snapshot.recovery.recommendation = bom?.status === 'offline' ? 'Verifique os logs e o estado desejado do bom-dia no runit.' : null;
      snapshot.recovery.locked = recoveryLocked;
      await save(); // Persist the budget before any side effect; write failures prevent recovery.
      if (enabled && !recoveryLocked && bom?.recoverable && bom.failures >= 3 && snapshot.recovery.attempts < LIMIT
        && (!snapshot.recovery.lastAttempt || now() - Date.parse(snapshot.recovery.lastAttempt) >= COOLDOWN)) {
        snapshot.recovery.attempts++;
        snapshot.recovery.lastAttempt = timestamp;
        await save();
        const result = await recover();
        snapshot.recovery.lastResult = result.ok ? 'Comando enviado; aguardando próxima leitura' : 'Falha ao solicitar sv up';
        await save();
      }
      await fs.writeFile(path.join(dir, 'watchdog.jsonl'), snapshot.history.map(row => JSON.stringify(row)).join('\n') + '\n');
      return snapshot;
    } finally { busy = false; }
  }
  return { tick };
}
async function readHealth(dir = stateDir) {
  const data = JSON.parse(await fs.readFile(path.join(dir, 'watchdog.json'), 'utf8'));
  return { ...data, stale: !Number.isFinite(Date.parse(data.timestamp)) || Date.now() - Date.parse(data.timestamp) > INTERVAL * 3 };
}
module.exports = { createMonitor, readHealth, httpProbe, tcpProbe, INTERVAL };
