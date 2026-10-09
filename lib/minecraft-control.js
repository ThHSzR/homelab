const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { command } = require('./collectors');
const { pingMinecraft } = require('./minecraft');
const { rcon } = require('./minecraft-rcon');
const { acquireServiceLock, failure } = require('./service-control');
const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
function properties(text) {
  const values = {};
  for (const row of text.split(/\r?\n/)) {
    if (/^\s*[#!]/.test(row) || !row.includes('=')) continue;
    const index = row.indexOf('='), key = row.slice(0, index).trim();
    if (Object.hasOwn(values, key)) throw failure('Propriedades duplicadas do Minecraft.');
    values[key] = row.slice(index + 1).trim();
  }
  return values;
}
function createMinecraftController({ dir = path.join(os.homedir(), 'minecraft'),
  enabled = process.env.MINECRAFT_CONTROL_ENABLED === '1',
  run = args => command(process.execPath, [path.join(PREFIX, 'lib/node_modules/pm2/bin/pm2'), ...args], 10),
  ping = pingMinecraft, send = rcon, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } } } = {}) {
  let transition = null, lastError = null, pending = null;
  const marker = path.join(dir, '.homelab-desired.json');
  async function inspect() {
    const result = await run(['jlist']);
    let list;
    try { list = JSON.parse(result.text); } catch { throw failure('Não foi possível consultar o PM2.'); }
    if (!result.ok || !Array.isArray(list)) throw failure('Não foi possível consultar o PM2.');
    const entries = list.filter(p => p.name === 'minecraft');
    if (entries.length !== 1) throw failure('Registre uma única instância minecraft no PM2.');
    const entry = entries[0], env = entry.pm2_env || {};
    if (env.pm_exec_path !== path.join(dir, 'start.sh') || env.pm_cwd !== dir ||
      env.exec_interpreter !== path.join(PREFIX, 'bin/bash') || env.exec_mode !== 'fork_mode' ||
      env.autorestart !== false || env.watch || env.cron_restart || env.max_memory_restart ||
      !Number.isInteger(entry.pm_id) || !['online', 'stopped', 'errored'].includes(env.status))
      throw failure('Configuração PM2 incompatível: use start.sh, fork e autorestart:false, sem outros reinícios automáticos.');
    const stat = await fs.stat(path.join(dir, 'server.properties'));
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw failure('Restrinja server.properties com chmod 600.');
    const config = properties(await fs.readFile(path.join(dir, 'server.properties'), 'utf8'));
    if (config['enable-rcon'] !== 'true' || config['server-ip'] !== '127.0.0.1' ||
      !/^[a-f0-9]{64}$/.test(config['rcon.password'] || ''))
      throw failure('Configure RCON local, server-ip=127.0.0.1 e senha hexadecimal de 64 caracteres.');
    const port = Number(config['rcon.port']), gamePort = Number(config['server-port'] || 25565);
    if (![port, gamePort].every(p => Number.isInteger(p) && p > 0 && p < 65536) || port === gamePort)
      throw failure('Portas Minecraft/RCON inválidas.');
    return { entry, config: { port, password: config['rcon.password'] }, gamePort };
  }
  async function status() {
    if (!enabled) return { state: 'unknown', available: false, reason: 'Habilite o controle após configurar PM2 e RCON local.' };
    try {
      const { entry, gamePort } = await inspect();
      const network = await ping(gamePort);
      const live = entry.pid > 0 && alive(entry.pid);
      const state = live && entry.pm2_env.status === 'online' ? (network.status === 'online' ? 'online' : 'starting') :
        !live && network.status === 'offline' ? 'offline' : 'unknown';
      return { state: transition || state, available: state !== 'unknown', reason: lastError };
    } catch (error) { return { state: transition || 'unknown', available: false, reason: error.status ? error.message : 'Configuração local indisponível.' }; }
  }
  async function persist(desired) {
    await fs.writeFile(marker + '.tmp', JSON.stringify({ desired }), { mode: 0o600 });
    await fs.rename(marker + '.tmp', marker);
  }
  async function checkedRun(args) {
    if (!(await run(args)).ok) throw failure('PM2 não confirmou a operação ou persistência. Verifique o estado local.');
  }
  async function operate(action, initial) {
    await persist(action === 'stop' ? 'offline' : 'online');
    if (action === 'start') {
      const current = await status();
      if (current.state === 'unknown') throw failure('Estado do Minecraft não confirmado.');
      if (!(initial.entry.pid > 0 && alive(initial.entry.pid))) await checkedRun(['start', String(initial.entry.pm_id)]);
      await checkedRun(['save']);
      const deadline = now() + 120000;
      while (now() < deadline) {
        const current = await inspect();
        if ((await ping(current.gamePort)).status === 'online' && current.entry.pid > 0 && alive(current.entry.pid)) return;
        if (current.entry.pm2_env.status !== 'online') throw failure('Minecraft encerrou durante a inicialização.');
        await sleep(1000);
      }
      throw failure('Inicialização ainda não confirmada. Verifique os logs; nenhum processo foi encerrado.');
    }
    const pid = initial.entry.pid;
    if (pid > 0 && alive(pid)) {
      await send(initial.config, 'save');
      await send(initial.config, 'stop');
      const deadline = now() + 120000;
      while (alive(pid) && now() < deadline) await sleep(1000);
      if (alive(pid)) throw failure('Minecraft ainda está encerrando. Nenhum kill foi enviado.');
    }
    // Only mark PM2 stopped after the original process has exited naturally.
    const current = await inspect();
    if ((current.entry.pid > 0 && alive(current.entry.pid)) || (await ping(current.gamePort)).status !== 'offline')
      throw failure('Processo ou porta ainda ativos. Nenhum sinal de parada foi enviado.');
    await checkedRun(['stop', String(current.entry.pm_id)]);
    await checkedRun(['save']);
  }
  async function request(action) {
    if (!['start', 'stop'].includes(action)) throw failure('Ação inválida.', 400);
    if (!enabled) throw failure('Controle Minecraft não habilitado.', 409);
    const release = await acquireServiceLock(dir);
    let initial;
    try {
      initial = await inspect();
      if ((await status()).state === 'unknown') throw failure('Estado real não confirmado.');
    } catch (error) { await release(); throw error; }
    transition = action === 'start' ? 'starting' : 'stopping'; lastError = null;
    pending = operate(action, initial).catch(error => {
      lastError = error.status ? error.message : 'Falha no controle seguro do Minecraft. Nenhum kill foi enviado.';
    }).finally(async () => { transition = null; await release(); }).catch(() => { lastError = 'Lock pendente de inspeção.'; });
    return { state: transition, available: true, accepted: true };
  }
  async function reconcile() {
    if (!enabled || transition) return;
    let saved;
    try { saved = JSON.parse(await fs.readFile(marker, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') lastError = 'Estado desejado inválido; reconciliação bloqueada.'; return; }
    // Startup is explicit; only a persisted manual stop may be reconciled.
    if (saved.desired === 'offline') {
      const current = await status();
      const initial = await inspect();
      if (current.available && (initial.entry.pid > 0 && alive(initial.entry.pid) || initial.entry.pm2_env.status !== 'stopped'))
        await request('stop');
    }
  }
  return { status, request, reconcile, settled: () => pending };
}
module.exports = { createMinecraftController, properties };
