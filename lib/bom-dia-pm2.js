const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { command } = require('./collectors');
const dir = path.join(os.homedir(), 'services/bom-dia');
const cli = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'lib/node_modules/pm2/bin/pm2');
function createPm2Controller({ servicePath = dir, run = command } = {}) {
  const marker = path.join(servicePath, 'desired.json');
  let transition = null, lastError = null;
  const fail = message => Object.assign(new Error(message), { status: 503 });
  const pm2 = args => run(process.execPath, [cli, ...args], args[0] === 'jlist' ? 4 : 18);
  async function inspect() {
    const result = await pm2(['jlist']);
    if (!result.ok) throw fail('PM2 não respondeu.');
    let entries;
    try { entries = JSON.parse(result.text); } catch { throw fail('Resposta PM2 inválida.'); }
    if (!Array.isArray(entries)) throw fail('Resposta PM2 inválida.');
    const matches = entries.filter(entry => entry.name === 'bom-dia');
    const entry = matches[0];
    if (matches.length !== 1 || !Number.isInteger(entry.pm_id) || entry.pm_id < 0 ||
      entry.pm2_env?.pm_exec_path !== path.join(servicePath, 'start.sh')) throw fail('Registro Bom Dia no PM2 não confirmado.');
    return entry;
  }
  async function status() {
    try {
      const entry = await inspect();
      const state = entry.pm2_env.status === 'online' && entry.pid > 0 ? 'online' :
        ['launching', 'waiting restart'].includes(entry.pm2_env.status) ? 'starting' :
        entry.pm2_env.status === 'stopping' ? 'stopping' :
        ['stopped', 'errored'].includes(entry.pm2_env.status) && !entry.pid ? 'offline' : 'unknown';
      return { state: transition || state, available: state !== 'unknown', manager: 'PM2', reason: state === 'unknown' ? 'Estado PM2 não confirmado.' : lastError };
    } catch (error) { return { state: transition || 'unknown', available: false, manager: 'PM2', reason: error.message }; }
  }
  async function set(action) {
    if (!['start', 'stop'].includes(action)) throw Object.assign(new Error('Ação inválida.'), { status: 400 });
    const { withServiceLock } = require('./service-control');
    return withServiceLock(servicePath, async () => {
      const entry = await inspect();
      if (!['online', 'offline'].includes((await status()).state)) throw Object.assign(new Error('Estado em transição ou desconhecido.'), { status: 409 });
      transition = action === 'start' ? 'starting' : 'stopping'; lastError = null;
      try {
        await fs.writeFile(marker + '.tmp', JSON.stringify({ desired: action === 'start' ? 'online' : 'offline' }), { mode: 0o600 });
        await fs.rename(marker + '.tmp', marker);
        if (!(await pm2([action, String(entry.pm_id)])).ok) throw fail('PM2 não confirmou a operação.');
        if (!(await pm2(['save'])).ok) throw fail('PM2 não confirmou a persistência.');
      } catch (error) { lastError = error.status ? error.message : 'Falha ao persistir o estado intencional.'; throw fail(lastError); }
      finally { transition = null; }
      const current = await status();
      if (current.state !== (action === 'start' ? 'online' : 'offline')) throw fail('Estado final não confirmado.');
      return current;
    });
  }
  async function reconcile() {
    let desired;
    try { desired = JSON.parse(await fs.readFile(marker, 'utf8')).desired; } catch { return; }
    if (desired === 'offline' && (await status()).state === 'online') await set('stop');
  }
  return { status, set, reconcile };
}
module.exports = { createPm2Controller };
