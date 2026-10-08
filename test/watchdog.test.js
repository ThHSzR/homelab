const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createMonitor, readHealth, httpProbe, tcpProbe, parseTailscaleProbe } = require('../lib/watchdog');
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('transitions preserve lastSeen, history is bounded and API marks old samples stale', async t => {
  const dir = await directory(t);
  let time = 1000000, status = 'online';
  const monitor = createMonitor({ dir, now: () => time, probes: { dashboard: async () => ({ status }) } });
  let data = await monitor.tick();
  const first = data.services.dashboard.lastSeen;
  time += 30000; status = 'offline';
  data = await monitor.tick();
  assert.equal(data.services.dashboard.lastSeen, first);
  const changed = data.services.dashboard.changedAt;
  for (let i = 0; i < 125; i++) { time += 30000; data = await monitor.tick(); }
  assert.equal(data.services.dashboard.changedAt, changed);
  assert.equal(data.history.length, 120);
  assert.equal((await fs.readFile(path.join(dir, 'watchdog.jsonl'), 'utf8')).trim().split('\n').length, 120);
  assert.equal((await readHealth(dir)).stale, true);
});
test('recovery is opt-in, requires failures, respects cooldown and persists lifetime budget', async t => {
  const dir = await directory(t);
  let time = Date.now(), calls = 0;
  const options = { dir, now: () => time, probes: { 'bom-dia': async () => ({ status: 'offline', recoverable: true }) },
    recover: async () => { calls++; return { ok: true }; } };
  const disabled = createMonitor({ ...options, enabled: false });
  for (let i = 0; i < 3; i++) await disabled.tick();
  assert.equal(calls, 0);
  const enabled = createMonitor({ ...options, enabled: true });
  await enabled.tick(); await enabled.tick();
  assert.equal(calls, 1);
  time += 600000; await enabled.tick();
  time += 600000; await enabled.tick();
  assert.equal(calls, 3);
  const restarted = createMonitor({ ...options, enabled: true });
  time += 600000; await restarted.tick();
  assert.equal(calls, 3);
});
test('manual stop/unknown status cannot recover; overlapping cycles are skipped', async t => {
  const dir = await directory(t);
  let release, calls = 0;
  const monitor = createMonitor({ dir, enabled: true, probes: { 'bom-dia': () => new Promise(resolve => { release = resolve; }) },
    recover: async () => { calls++; return { ok: true }; } });
  const pending = monitor.tick();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(await monitor.tick(), undefined);
  release({ status: 'offline', recoverable: false });
  await pending;
  assert.equal(calls, 0);
});
test('corrupt state locks recovery across restarts and failed persistence prevents actions', async t => {
  const dir = await directory(t);
  await fs.writeFile(path.join(dir, 'watchdog.json'), '{');
  let calls = 0;
  const options = { dir, enabled: true, probes: { 'bom-dia': async () => ({ status: 'offline', recoverable: true }) },
    recover: async () => { calls++; return { ok: true }; } };
  for (let i = 0; i < 4; i++) await createMonitor(options).tick();
  assert.equal(calls, 0);
  assert.equal((await readHealth(dir)).recovery.locked, true);
  const file = path.join(dir, 'not-directory');
  await fs.writeFile(file, 'x');
  await assert.rejects(createMonitor({ ...options, dir: file }).tick());
  assert.equal(calls, 0);
});
test('fresh monitor waits for three failures and does not recover intentional stops or unknown services', async t => {
  const dir = await directory(t);
  let status = 'offline', recoverable = true, calls = 0, time = Date.now();
  const monitor = createMonitor({ dir, enabled: true, now: () => time,
    probes: { 'bom-dia': async () => ({ status, recoverable }) },
    recover: async () => { calls++; return { ok: false }; } });
  await monitor.tick(); await monitor.tick();
  assert.equal(calls, 0);
  await monitor.tick();
  assert.equal(calls, 1);
  recoverable = false; time += 600000;
  for (let i = 0; i < 4; i++) await monitor.tick();
  status = 'unknown'; recoverable = true;
  for (let i = 0; i < 4; i++) await monitor.tick();
  assert.equal(calls, 1);
});
test('HTTP and TCP probes distinguish local availability and HTTP failures', async t => {
  const server = http.createServer((req, res) => { res.writeHead(req.url === '/healthz' ? 200 : 503); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  assert.equal((await httpProbe(`http://127.0.0.1:${port}/healthz`)).status, 'online');
  assert.equal((await httpProbe(`http://127.0.0.1:${port}/fail`)).status, 'offline');
  assert.equal((await tcpProbe(port)).status, 'online');
});

test('Tailscale detects active Android VPN without treating command errors as offline', () => {
  const entry = (ip, flags = ['UP']) => ({
    ifname: 'tun0', flags, addr_info: [{ family: 'inet', local: ip }]
  });
  const result = interfaces => parseTailscaleProbe({ ok: true, text: JSON.stringify(interfaces) });
  assert.equal(result([entry('100.66.241.113')]).status, 'online');
  assert.equal(result([entry('100.66.241.113')]).ip, '100.66.241.113');
  assert.equal(result([entry('100.66.241.113', [])]).status, 'offline');
  assert.equal(result([entry('100.2.3.4')]).status, 'offline');
  assert.equal(result([]).status, 'offline');
  assert.equal(parseTailscaleProbe({ ok: false, text: '' }).status, 'unknown');
  assert.equal(parseTailscaleProbe({ ok: true, text: 'not json' }).status, 'unknown');
});

test('Tailscale watchdog keeps status transitions, detail and prior online timestamp', async t => {
  const dir = await directory(t);
  let online = true;
  let time = Date.now();
  const monitor = createMonitor({
    dir, now: () => time,
    probes: { tailscale: async () => parseTailscaleProbe({
      ok: true, text: JSON.stringify(online ? [{
        ifname: 'tun0', flags: ['UP'],
        addr_info: [{ family: 'inet', local: '100.66.241.113' }]
      }] : [])
    }) }
  });
  const first = await monitor.tick();
  assert.equal(first.services.tailscale.status, 'online');
  assert.match(first.services.tailscale.detail, /tun0/);
  const firstSeen = first.services.tailscale.lastSeen;
  time += 30000; online = false;
  const second = await monitor.tick();
  assert.equal(second.services.tailscale.status, 'offline');
  assert.equal(second.services.tailscale.lastSeen, firstSeen);
  assert.equal(second.history.length, 2);
});
