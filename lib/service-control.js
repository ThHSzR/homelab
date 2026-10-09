const fs = require('node:fs/promises');
const path = require('node:path');
const { command } = require('./collectors');
const serviceDir = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'var/service/bom-dia');
function failure(message, status = 503) { return Object.assign(new Error(message), { status }); }
// Shared with the independent watchdog. Never steal a lock: after a crash an
// administrator must inspect it before removing it.
async function withServiceLock(dir, action) {
  const lock = path.join(dir, '.homelab-control-lock');
  try { await fs.mkdir(lock); }
  catch (error) { throw failure(error.code === 'EEXIST' ? 'Operação em andamento ou lock pendente de inspeção.' : 'Supervisor indisponível.', 409); }
  try { return await action(); } finally { await fs.rmdir(lock); }
}
function createController({ dir = serviceDir, run = command } = {}) {
  let transition = null;
  async function status() {
    const result = await run('sv', ['status', dir]);
    const state = result.text.startsWith('run:') ? 'online' : result.text.startsWith('down:') ? 'offline' : 'unknown';
    return { state: transition || state, available: state !== 'unknown', reason: state === 'unknown' ? 'Serviço runit não confirmado.' : null };
  }
  async function set(action) {
    if (!['start', 'stop'].includes(action)) throw failure('Ação inválida.', 400);
    return withServiceLock(dir, async () => {
      if (!(await status()).available) throw failure('Serviço runit não confirmado.');
      transition = action === 'start' ? 'starting' : 'stopping';
      try {
        // runit down is persistent across supervisor/Android restarts, and is
        // also checked by watchdog while holding this same lock.
        if (action === 'stop') await fs.writeFile(path.join(dir, 'down'), '', { mode: 0o600 });
        else await fs.rm(path.join(dir, 'down'), { force: true });
        const result = await run('sv', ['-w', '15', action === 'start' ? 'up' : 'down', dir], 18);
        if (!result.ok) throw failure('Supervisor não confirmou a operação; verifique os logs.');
      } finally { transition = null; }
      const current = await status();
      if (current.state !== (action === 'start' ? 'online' : 'offline')) throw failure('Estado final não confirmado; atualize e verifique os logs.');
      return current;
    });
  }
  async function reconcile() {
    return withServiceLock(dir, async () => {
      const down = await fs.access(path.join(dir, 'down')).then(() => true, () => false);
      if (down && (await status()).state === 'online') await run('sv', ['-w', '15', 'down', dir], 18);
    });
  }
  return { status, set, reconcile };
}
module.exports = { createController, withServiceLock, serviceDir, failure };
