const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { command } = require('./collectors');
const { withServiceLock, failure } = require('./service-control');
const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';

// Queries only the private userspace socket, never the Android VPN or peers.
function daemonStatus(socketPath) {
  return new Promise(resolve => {
    let done = false, size = 0, chunks = [];
    const finish = value => { if (done) return; done = true; clearTimeout(timer); request.destroy(); resolve(value); };
    const request = http.get({ socketPath, path: '/localapi/v0/status?peers=false', headers: { Host: 'local-tailscaled.sock' } }, response => {
      response.on('data', chunk => { size += chunk.length; if (size > 65536) finish(null); else chunks.push(chunk); });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) return finish(null);
          const data = JSON.parse(Buffer.concat(chunks));
          finish({ backendState: typeof data.BackendState === 'string' ? data.BackendState.slice(0, 80) : 'Unknown',
            ip: Array.isArray(data.TailscaleIPs) ? data.TailscaleIPs.find(ip => /^100\.\d+\.\d+\.\d+$/.test(ip)) || null : null });
        } catch { finish(null); }
      });
      response.on('error', () => finish(null));
    });
    const timer = setTimeout(() => finish(null), 3000);
    request.on('error', () => finish(null));
  });
}

function createTailscaleController({ dir = path.join(os.homedir(), 'services/tailscale-userspace'),
  enabled = process.env.TAILSCALE_CONTROL_ENABLED === '1',
  run = args => command(process.execPath, [path.join(PREFIX, 'lib/node_modules/pm2/bin/pm2'), ...args], args[0] === 'jlist' ? 4 : 18),
  query = daemonStatus } = {}) {
  const marker = path.join(dir, 'desired.json');
  let transition = null, lastError = null;
  async function inspect() {
    const result = await run(['jlist']);
    let list;
    try { list = JSON.parse(result.text); } catch { throw failure('PM2 indisponível.'); }
    if (!result.ok || !Array.isArray(list)) throw failure('PM2 indisponível.');
    const entries = list.filter(p => p.name === 'tailscale-userspace');
    const entry = entries[0], env = entry?.pm2_env;
    if (entries.length !== 1 || !Number.isInteger(entry.pm_id) || entry.pm_id < 0 ||
      env.pm_exec_path !== path.join(dir, 'supervisor.cjs') || env.exec_interpreter !== process.execPath ||
      env.exec_mode !== 'fork_mode' || env.watch || env.cron_restart || env.max_memory_restart ||
      !['online', 'stopped', 'errored', 'waiting restart', 'launching', 'stopping'].includes(env.status))
      throw failure('Instância tailscale-userspace / supervisor PM2 não confirmada.');
    return entry;
  }
  async function ready(entry) {
    if (!enabled) throw failure('Configure o supervisor persistente e TAILSCALE_CONTROL_ENABLED=1.');
    const source = await fs.readFile(path.join(dir, 'supervisor.cjs'), 'utf8');
    const desired = JSON.parse(await fs.readFile(marker, 'utf8')).desired;
    if (!source.includes('HOMELAB_DESIRED_V1') || !['online', 'offline'].includes(desired) ||
      !entry.pm2_env.stop_exit_codes?.includes(0) || entry.pm2_env.kill_timeout < 4000)
      throw failure('Supervisor sem trava de parada persistente; siga a implantação no README.');
  }
  async function status() {
    try {
      const entry = await inspect();
      let state = entry.pm2_env.status === 'online' && entry.pid > 0 ? 'online' :
        entry.pm2_env.status === 'launching' || entry.pm2_env.status === 'waiting restart' ? 'starting' :
        entry.pm2_env.status === 'stopping' ? 'stopping' :
        ['stopped', 'errored'].includes(entry.pm2_env.status) && !entry.pid ? 'offline' : 'unknown';
      let reason = lastError, available = state !== 'unknown';
      if (state === 'offline' && await query(path.join(dir, 'state/tailscaled.sock'))) {
        state = 'unknown'; available = false; reason = 'PM2 parado, mas o daemon ainda responde; inspecione a instância antes de iniciar.';
      }
      try { await ready(entry); } catch (error) { available = false; reason = error.status ? error.message : 'Configuração persistente indisponível.'; }
      return { state: transition || state, available, reason, manager: 'PM2' };
    } catch (error) { return { state: transition || 'unknown', available: false, reason: error.message, manager: 'PM2' }; }
  }
  async function set(action) {
    if (!['start', 'stop'].includes(action)) throw failure('Ação inválida.', 400);
    return withServiceLock(dir, async () => {
      const entry = await inspect(); await ready(entry);
      if (!['online', 'offline'].includes((await status()).state)) throw failure('Transição ou estado desconhecido.', 409);
      transition = action === 'start' ? 'starting' : 'stopping'; lastError = null;
      try {
        await fs.writeFile(marker + '.tmp', JSON.stringify({ desired: action === 'start' ? 'online' : 'offline' }), { mode: 0o600 });
        await fs.rename(marker + '.tmp', marker);
        if (!(await run([action, String(entry.pm_id)])).ok) throw failure('PM2 não confirmou a operação.');
        if (!(await run(['save'])).ok) throw failure('PM2 não confirmou a persistência.');
      } catch (error) { lastError = error.status ? error.message : 'Falha ao persistir estado intencional.'; throw failure(lastError); }
      finally { transition = null; }
      const current = await status();
      if (current.state !== (action === 'start' ? 'online' : 'offline')) throw failure('Estado final PM2 não confirmado.');
      return current;
    });
  }
  async function reconcile() {
    if (!enabled || transition) return;
    let desired;
    try { desired = JSON.parse(await fs.readFile(marker, 'utf8')).desired; } catch { return; }
    if (desired === 'offline' && (await status()).state === 'online') await set('stop');
  }
  async function probe() {
    try {
      const entry = await inspect();
      const data = await query(path.join(dir, 'state/tailscaled.sock'));
      if (['stopped', 'errored'].includes(entry.pm2_env.status) && !entry.pid)
        return data ? { status: 'unknown', detail: 'Supervisor parado, mas daemon userspace ainda responde.' } :
          { status: 'offline', detail: 'Supervisor userspace parado no PM2; API do daemon não responde.' };
      return data ? { status: data.backendState === 'Running' ? 'online' : 'unknown', ...data,
        detail: 'PM2 · ' + data.backendState + ' · alcance remoto não verificado' } :
        { status: 'unknown', detail: 'Supervisor presente; API do daemon userspace não respondeu.' };
    } catch (error) { return { status: 'unknown', detail: error.status ? error.message : 'Consulta userspace indisponível.' }; }
  }
  return { status, set, reconcile, probe };
}
module.exports = { createTailscaleController, daemonStatus };
