const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const dns = require('node:dns/promises');
const { performance } = require('node:perf_hooks');
const { command, tailnetAddress } = require('./collectors');
const { createMinecraftProbe, pingMinecraft } = require('./minecraft');
const { withServiceLock } = require('./service-control');
const { advanceUptime } = require('./uptime');
const stateDir = process.env.WATCHDOG_STATE_DIR || path.join(os.homedir(), 'services/state');
const serviceDir = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'var/service/bom-dia');
const INTERVAL = 30000;
const COOLDOWN = 10 * 60 * 1000;
const LIMIT = 3;
const HISTORY = 120;

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
function parseTailscaleProbe(result) {
  if (!result?.ok) {
    return { status: 'unknown', detail: 'Não foi possível consultar as interfaces de rede do Android.' };
  }
  let interfaces;
  try {
    interfaces = JSON.parse(result.text);
    if (!Array.isArray(interfaces)) throw new Error('Interface list is not an array');
  } catch {
    return { status: 'unknown', detail: 'Resposta inválida ao consultar as interfaces do Android.' };
  }
  const tunnel = tailnetAddress(interfaces);
  if (!tunnel) return { status: 'offline', detail: 'VPN Tailscale não detectada nas interfaces ativas do Android.' };
  return {
    status: 'online',
    interface: tunnel.interface,
    ip: tunnel.ip,
    detail: tunnel.interface + ' · ' + tunnel.ip + ' · alcance remoto não verificado'
  };
}
async function tailscaleProbe() {
  return parseTailscaleProbe(await command('ip', ['-j', 'addr']));
}
async function pm2Probe(name) {
  const cli = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'lib/node_modules/pm2/bin/pm2');
  const result = await command(process.execPath, [cli, 'jlist'], 5);
  if (!result.ok) return { status: 'unknown', detail: 'PM2 não respondeu.' };
  try {
    const entries = JSON.parse(result.text).filter(item => item.name === name);
    if (entries.length !== 1) return { status: 'unknown', detail: 'Instância PM2 não confirmada.' };
    const state = entries[0].pm2_env?.status;
    return { status: state === 'online' ? 'online' : state === 'stopped' || state === 'errored' ? 'offline' : 'unknown',
      detail: 'PM2 · ' + state };
  } catch { return { status: 'unknown', detail: 'Resposta PM2 inválida.' }; }
}
async function publicDashboardProbe() {
  const id = process.env.CF_ACCESS_PROBE_ID, secret = process.env.CF_ACCESS_PROBE_SECRET;
  if (!id || !secret) return { status: 'unknown', detail: 'Configure um token de serviço Access para testar o origin pelo hostname público.' };
  try {
    const response = await fetch('https://homelab.thsouza.eng.br/healthz', {
      headers: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret },
      signal: AbortSignal.timeout(6000), redirect: 'error', cache: 'no-store'
    });
    if (!response.ok) return { status: 'offline', detail: 'Hostname público retornou HTTP ' + response.status };
    const data = await response.json();
    return data.status === 'ok' ? { status: 'online', detail: 'Origin respondeu pelo Cloudflare Access; teste executado no A30.' } :
      { status: 'offline', detail: 'Resposta pública não corresponde ao healthz.' };
  } catch { return { status: 'offline', detail: 'Hostname público não confirmou o origin.' }; }
}
async function publicMinecraftProbe() {
  const host = process.env.PLAYIT_PUBLIC_HOST;
  if (!host || !/^[a-z0-9.-]{1,253}$/i.test(host))
    return { status: 'unknown', detail: 'Configure PLAYIT_PUBLIC_HOST para verificar o jogo publicado.' };
  let target = host, port = Number(process.env.PLAYIT_PUBLIC_PORT || 25565);
  if (!process.env.PLAYIT_PUBLIC_PORT) {
    try {
      const records = await dns.resolveSrv('_minecraft._tcp.' + host);
      const record = records.sort((a, b) => a.priority - b.priority)[0];
      if (record) { target = record.name; port = record.port; }
    } catch { /* Sem SRV: usa host e porta padrão do Minecraft. */ }
  }
  if (!/^[a-z0-9.-]{1,253}$/i.test(target) || !Number.isInteger(port) || port < 1 || port > 65535)
    return { status: 'unknown', detail: 'Destino Playit inválido.' };
  const result = await pingMinecraft(port, target, host);
  return { status: result.status === 'possible' ? 'unknown' : result.status,
    detail: result.detail + ' · ' + target + ':' + port + ' · teste executado no A30.' };
}
async function readIntent(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')).desired;
    return ['online', 'offline'].includes(value) ? value : null;
  } catch { return null; }
}
async function expectedStates(home = os.homedir()) {
  const [bom, minecraft, tailscale] = await Promise.all([
    readIntent(path.join(home, 'services/bom-dia/desired.json')),
    readIntent(path.join(home, 'minecraft/.homelab-desired.json')),
    readIntent(path.join(home, 'services/tailscale-userspace/desired.json'))
  ]);
  return { dashboard: 'online', ssh: 'online', external: 'online',
    playit: 'online', 'cloudflare-tunnel': 'online', 'public-dashboard': 'online',
    'bom-dia': bom || 'online', minecraft: minecraft || 'online',
    'minecraft-public': minecraft || 'online', 'tailscale-userspace': tailscale };
}
async function runitProbe() {
  if (process.env.BOM_DIA_MANAGER === 'pm2') {
    const result = await require('./bom-dia-pm2').createPm2Controller().status();
    return { status: result.state, recoverable: false, manager: 'PM2', detail: result.reason || 'PM2 · ' + result.state };
  }
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
    minecraft: createMinecraftProbe(), tailscale: tailscaleProbe,
    playit: () => pm2Probe('playit'), 'cloudflare-tunnel': () => pm2Probe('cloudflare-tunnel'),
    'public-dashboard': publicDashboardProbe, 'minecraft-public': publicMinecraftProbe,
    'tailscale-userspace': require('./tailscale-control').createTailscaleController().probe },
  intentions = expectedStates,
  recover = async () => {
    try {
      return await withServiceLock(serviceDir, async () => {
        const current = await runitProbe();
        if (!current.recoverable) return { ok: false };
        return command('sv', ['up', serviceDir]);
      });
    } catch { return { ok: false }; }
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
      const previousServices = snapshot.services;
      const previousTimestamp = snapshot.timestamp;
      const expected = await intentions();
      const results = await Promise.all(Object.entries(probes).map(async ([id, probe]) => {
        const start = performance.now();
        let result;
        try { result = await probe(); } catch { result = { status: 'offline', detail: 'Timeout ou falha de conexão' }; }
        const previous = previousServices[id];
        return [id, { ...result, latencyMs: Math.round(performance.now() - start), checkedAt: timestamp,
          expected: expected[id] || null,
          lastSeen: result.status === 'online' ? timestamp : previous?.lastSeen || null,
          changedAt: previous?.status === result.status ? previous.changedAt : timestamp,
          failures: result.status === 'offline' ? (previous?.failures || 0) + 1 : 0,
          unknowns: result.status === 'unknown' ? (previous?.unknowns || 0) + 1 : 0 }];
      }));
      snapshot.services = Object.fromEntries(results);
      snapshot.uptime = advanceUptime(snapshot.uptime, previousServices, snapshot.services, previousTimestamp, timestamp);
      snapshot.timestamp = timestamp;
      snapshot.intervalMs = INTERVAL;
      snapshot.history = [...snapshot.history, { timestamp, services: snapshot.services }].slice(-HISTORY);
      snapshot.recovery.enabled = enabled;
      const bom = snapshot.services['bom-dia'];
      snapshot.recovery.recommendation = bom?.status === 'offline' ? 'Verifique os logs e o estado desejado do bom-dia no ' + (process.env.BOM_DIA_MANAGER === 'pm2' ? 'PM2.' : 'runit.') : null;
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
module.exports = { createMonitor, readHealth, httpProbe, tcpProbe, parseTailscaleProbe,
  pm2Probe, publicDashboardProbe, publicMinecraftProbe, expectedStates, INTERVAL };
