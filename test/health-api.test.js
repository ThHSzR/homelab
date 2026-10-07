const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMonitor } = require('../lib/watchdog');
test('health API returns 503 until first sample, then reports fresh and stale state', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-api-'));
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', WATCHDOG_STATE_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000);
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/porta (\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once('error', reject);
  });
  const url = `http://127.0.0.1:${port}/api/health`;
  assert.equal((await fetch(url)).status, 503);
  await createMonitor({ dir, probes: { dashboard: async () => ({ status: 'online' }) } }).tick();
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).stale, false);
  await createMonitor({ dir, now: () => Date.now() - 120000, probes: {} }).tick();
  assert.equal((await (await fetch(url)).json()).stale, true);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
});
