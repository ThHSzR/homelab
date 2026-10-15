const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function connection(plugged) {
  if (plugged === 'UNPLUGGED') return 'unplugged';
  if (typeof plugged === 'string' && /^PLUGGED_/.test(plugged)) return 'plugged';
  return null;
}

function createPowerTracker({ dir = process.env.WATCHDOG_STATE_DIR || path.join(os.homedir(), 'services/state'),
  now = Date.now } = {}) {
  let state = null;
  async function update(battery) {
    if (!state) {
      try { state = JSON.parse(await fs.readFile(path.join(dir, 'power.json'), 'utf8')); }
      catch { state = { connection: null, changedAt: null, outageStartedAt: null, history: [] }; }
    }
    const current = battery?.available ? connection(battery.plugged) : null;
    if (!current) return { ...state, available: false };
    if (current !== state.connection) {
      const at = new Date(now()).toISOString();
      const was = state.connection;
      const outageMs = was === 'unplugged' && state.outageStartedAt ? now() - Date.parse(state.outageStartedAt) : null;
      const next = { connection: current, changedAt: at,
        outageStartedAt: current === 'unplugged' ? at : null,
        history: [...(state.history || []), ...(was ? [{ at, from: was, to: current,
          ...(outageMs != null && outageMs >= 0 ? { outageMs } : {}) }] : [])].slice(-200) };
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'power.json.tmp'), JSON.stringify(next), { mode: 0o600 });
      await fs.rename(path.join(dir, 'power.json.tmp'), path.join(dir, 'power.json'));
      state = next;
    }
    return { ...state, available: true };
  }
  return { update };
}

module.exports = { connection, createPowerTracker };
