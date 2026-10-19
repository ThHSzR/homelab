const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { createMonitor } = require('../lib/watchdog');

// Do not parse console output to determine the child's port: Termux stdout can
// be delayed/buffered and it is not a reliable server-readiness protocol.
async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => {
    listener.close(error => error ? reject(error) : resolve());
  });
  return port;
}

test('health API returns 503 until first sample, then reports fresh and stale state', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-api-'));
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    // The integration server must never reconcile production PM2/runit intent
    // or read private state, even when npm test runs directly in Termux.
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', WATCHDOG_STATE_DIR: dir,
      HOME: dir, USERPROFILE: dir, PREFIX: path.join(dir, 'usr'), PM2_HOME: path.join(dir, '.pm2'),
      BOM_DIA_MANAGER: 'pm2', MINECRAFT_CONTROL_ENABLED: '0', TAILSCALE_CONTROL_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '', startupError = null, exitDetail = null;
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-2048); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2048); });
  child.on('error', error => { startupError = error; });
  child.on('exit', (code, signal) => { exitDetail = { code, signal }; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      let timeout;
      await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(resolve, 5000); })]);
      clearTimeout(timeout);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  // Poll the real HTTP endpoint. A working listener matters more than stdout.
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (startupError || exitDetail) {
      throw new Error('Servidor de teste encerrou: ' + (startupError?.message || JSON.stringify(exitDetail)) +
        '; stdout=' + stdout + '; stderr=' + stderr);
    }
    try {
      const response = await fetch(url + '/healthz', {
        cache: 'no-store', signal: AbortSignal.timeout(1500)
      });
      await response.body?.cancel();
      if (response.ok) { ready = true; break; }
    } catch { /* Listener not ready yet. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, 'Servidor não respondeu ao healthz em 30 segundos; stdout=' +
    stdout + '; stderr=' + stderr + '; exit=' + JSON.stringify(exitDetail));

  const healthUrl = url + '/api/health';
  assert.equal((await fetch(healthUrl)).status, 503);
  const missingNetwork = await fetch(url + '/api/network');
  assert.equal(missingNetwork.status, 503);
  assert.equal(missingNetwork.headers.get('cache-control'), 'no-store');
  assert.match((await missingNetwork.json()).error, /primeira leitura/);
  await createMonitor({ dir, probes: { dashboard: async () => ({ status: 'online' }) } }).tick();
  const response = await fetch(healthUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).stale, false);
  await createMonitor({ dir, now: () => Date.now() - 120000, probes: {} }).tick();
  assert.equal((await (await fetch(healthUrl)).json()).stale, true);
  assert.equal((await fetch(url + '/')).status, 200);
  const sample = { timestamp: new Date().toISOString(), history: [], devices: [], traffic: [], ports: [] };
  await fs.writeFile(path.join(dir, 'network.json'), JSON.stringify(sample));
  const network = await fetch(url + '/api/network');
  assert.equal(network.status, 200);
  assert.equal(network.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await network.json(), { ...sample, stale: false });
  const unknownLog = await fetch(url + '/api/logs/unknown');
  assert.equal(unknownLog.status, 400);
  assert.equal(unknownLog.headers.get('cache-control'), 'no-store');
  assert.match((await unknownLog.json()).error, /inválido/);
});
