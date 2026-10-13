const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMinecraftProbe } = require('../lib/minecraft');
const { createMonitor } = require('../lib/watchdog');
async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpu-proc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '123'));
  await fs.writeFile(path.join(root, '123/cmdline'), '/usr/bin/java\0-jar\0server.jar\0');
  await fs.writeFile(path.join(root, '123/status'), 'VmRSS: 1024 kB');
  async function ticks(value, start = 50) {
    const fields = Array(22).fill('0'); fields[0] = 'S'; fields[11] = String(value); fields[19] = String(start);
    await fs.writeFile(path.join(root, '123/stat'), '123 (Java thread) ' + fields.join(' '));
  }
  await ticks(100);
  let time = 1000;
  const opts = { procRoot: root, now: () => time, clockTicks: async () => 100,
    ping: async () => ({ status: 'online' }), ...extra };
  return { root, ticks, opts, probe: createMinecraftProbe(opts), advance: ms => { time += ms; } };
}
test('Android /proc/stat EACCES: process ticks and monotonic clock produce multi-core, idle and periodic rates', async t => {
  const f = await fixture(t, { readFile: async (file, ...args) => {
    if (file.endsWith(path.sep + 'stat') && !file.includes(path.sep + '123' + path.sep))
      throw Object.assign(new Error(), { code: 'EACCES' });
    return fs.readFile(file, ...args);
  } });
  const monitor = createMonitor({ dir: path.join(f.root, 'monitor'), probes: { minecraft: f.probe } });
  assert.match((await monitor.tick()).services.minecraft.process.cpuReason, /Primeira amostra/);
  await f.ticks(6100); f.advance(30000);
  const second = (await monitor.tick()).services.minecraft.process;
  assert.equal(second.cpuPercent, 200); assert.equal(second.sampleIntervalMs, 30000);
  f.advance(30000);
  assert.equal((await monitor.tick()).services.minecraft.process.cpuPercent, 0);
});
test('PID reuse, restart, regressing ticks, missing frequency and invalid interval explain unavailable CPU', async t => {
  const f = await fixture(t); await f.probe();
  await f.ticks(200, 99); f.advance(1000);
  assert.match((await f.probe()).process.cpuReason, /reiniciado/);
  await f.ticks(190, 99); f.advance(1000);
  assert.match((await f.probe()).process.cpuReason, /retrocedeu/);
  assert.match((await f.probe()).process.cpuReason, /Intervalo/);
  const fresh = createMinecraftProbe(f.opts);
  assert.match((await fresh()).process.cpuReason, /Primeira amostra/);
  const unavailable = createMinecraftProbe({ ...f.opts, clockTicks: async () => null });
  assert.match((await unavailable()).process.cpuReason, /CLK_TCK indisponível/);
});
test('permission failures, unknown Java, malformed stat and ambiguous candidates never invent a CPU sample', async t => {
  const f = await fixture(t, { readFile: async (file, ...args) => {
    if (file.endsWith(path.join('123', 'stat'))) throw Object.assign(new Error(), { code: 'EACCES' });
    return fs.readFile(file, ...args);
  } });
  assert.match((await f.probe()).cpuReason, /EACCES/);
  await fs.writeFile(path.join(f.root, '123/stat'), 'invalid');
  const raw = createMinecraftProbe({ ...f.opts, readFile: fs.readFile });
  assert.match((await raw()).cpuReason, /inválido/);
  await f.ticks(100);
  await fs.writeFile(path.join(f.root, '123/cmdline'), '/usr/bin/java\0-jar\0other.jar\0');
  assert.equal((await raw()).process, null);
  await fs.writeFile(path.join(f.root, '123/cmdline'), '/usr/bin/java\0-jar\0server.jar\0');
  await fs.cp(path.join(f.root, '123'), path.join(f.root, '456'), { recursive: true });
  assert.match((await raw()).cpuReason, /ambíguo/);
});
