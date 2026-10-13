const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createTailscaleController } = require('../lib/tailscale-control');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tailscale-control-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'supervisor.cjs'), '// HOMELAB_DESIRED_V1');
  await fs.writeFile(path.join(dir, 'desired.json'), JSON.stringify({ desired: 'online' }));
  const entry = { name: 'tailscale-userspace', pm_id: 4, pid: 123, pm2_env: { status: 'online',
    pm_exec_path: path.join(dir, 'supervisor.cjs'), exec_interpreter: process.execPath,
    exec_mode: 'fork_mode', stop_exit_codes: [0], kill_timeout: 4000 } };
  const calls = []; let release = null, hold = false;
  const opts = { dir, enabled: true, query: async () => entry.pid ? ({ backendState: 'Running', ip: '100.65.49.34' }) : null,
    run: async args => {
      if (args[0] === 'jlist') return { ok: true, text: JSON.stringify([entry]) };
      calls.push(args);
      if (hold) await new Promise(resolve => { release = resolve; });
      if (args[0] === 'stop') { entry.pid = 0; entry.pm2_env.status = 'stopped'; }
      if (args[0] === 'start') { entry.pid = 123; entry.pm2_env.status = 'online'; }
      return { ok: true };
    } };
  return { dir, entry, calls, opts, c: createTailscaleController(opts), hold: () => { hold = true; },
    release: () => { hold = false; release(); }, waiting: () => !!release };
}
test('Termux userspace controls only validated PM2 ID, persists manual stop, reconciles and never starts automatically', async t => {
  const f = await fixture(t);
  assert.equal((await f.c.probe()).ip, '100.65.49.34');
  assert.equal((await f.c.set('stop')).state, 'offline');
  assert.equal((await f.c.probe()).status, 'offline');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir, 'desired.json'))).desired, 'offline');
  f.entry.pid = 123; f.entry.pm2_env.status = 'online';
  await createTailscaleController(f.opts).reconcile();
  assert.equal(f.entry.pid, 0); assert.ok(!f.calls.some(a => a[0] === 'start'));
  assert.equal((await f.c.set('start')).state, 'online');
  assert.ok(f.calls.filter(a => ['start', 'stop'].includes(a[0])).every(a => a[1] === '4'));
  await assert.rejects(f.c.set('tailscale down'), { status: 400 });
});
test('unknown PM2, mismatched script, missing persistent guard and malformed desired state block operations', async t => {
  const f = await fixture(t);
  f.entry.pm2_env.pm_exec_path = '/watchdog.js';
  assert.equal((await f.c.status()).available, false); await assert.rejects(f.c.set('stop'));
  f.entry.pm2_env.pm_exec_path = path.join(f.dir, 'supervisor.cjs');
  await fs.writeFile(path.join(f.dir, 'supervisor.cjs'), '// old supervisor');
  await assert.rejects(f.c.set('stop'));
  await fs.writeFile(path.join(f.dir, 'supervisor.cjs'), '// HOMELAB_DESIRED_V1');
  await fs.writeFile(path.join(f.dir, 'desired.json'), '{');
  await assert.rejects(f.c.set('start')); assert.deepEqual(f.calls, []);
  const unknown = createTailscaleController({ ...f.opts, run: async () => ({ ok: true, text: '[]' }) });
  assert.equal((await unknown.probe()).status, 'unknown');
});
test('userspace transition locks competing requests; daemon failure and NeedsLogin remain unknown', async t => {
  const f = await fixture(t); f.hold();
  const pending = f.c.set('stop');
  while (!f.waiting()) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.c.status()).state, 'stopping');
  await assert.rejects(f.c.set('start'), { status: 409 });
  f.release(); await pending;
  f.entry.pid = 123; f.entry.pm2_env.status = 'online';
  assert.equal((await createTailscaleController({ ...f.opts, query: async () => null }).probe()).status, 'unknown');
  assert.equal((await createTailscaleController({ ...f.opts, query: async () => ({ backendState: 'NeedsLogin' }) }).probe()).status, 'unknown');
});
test('stopped PM2 with a still-responding orphan daemon refuses to start a second instance', async t => {
  const f = await fixture(t); f.entry.pid = 0; f.entry.pm2_env.status = 'stopped';
  const c = createTailscaleController({ ...f.opts, query: async () => ({ backendState: 'Running' }) });
  assert.equal((await c.status()).available, false); assert.equal((await c.probe()).status, 'unknown');
  await assert.rejects(c.set('start'), { status: 409 }); assert.deepEqual(f.calls, []);
});
test('deployed supervisor exits before spawning if a resurrection finds offline or invalid intent', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-supervisor-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'services/tailscale-userspace'); await fs.mkdir(dir, { recursive: true });
  for (const desired of ['{"desired":"offline"}', '{']) {
    await fs.writeFile(path.join(dir, 'desired.json'), desired);
    const child = spawn(process.execPath, [path.join(__dirname, '../deploy/tailscale-supervisor.cjs')],
      { env: { ...process.env, HOME: home }, stdio: 'ignore' });
    const code = await new Promise(resolve => child.once('exit', resolve));
    assert.equal(code, 0);
  }
});
