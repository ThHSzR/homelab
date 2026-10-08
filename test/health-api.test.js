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
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error('Startup timeout (30 s). stdout=' + output.slice(-1000) +
        '; stderr=' + errors.slice(-1000)));
    }, 30000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/porta (\d+)/);
      if (match) finish(null, Number(match[1]));
      if (output.length > 4096) output = output.slice(-2048);
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2048); });
    child.once('error', error => finish(error));
    child.once('exit', (code, signal) => {
      finish(new Error('Servidor de teste encerrou antes do startup: code=' + code +
        ' signal=' + signal + '; stderr=' + errors.slice(-1000)));
    });
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
