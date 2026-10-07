const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createMinecraftProbe, pingMinecraft, javaJar, varint } = require('../lib/minecraft');

function frame(payload) { return Buffer.concat([varint(payload.length), payload]); }
test('Minecraft status ping verifies the protocol and reads player count', async t => {
  const server = net.createServer(socket => socket.once('data', () => {
    const info = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.21' }, players: { online: 2, max: 10 } }));
    socket.end(frame(Buffer.concat([varint(0), varint(info.length), info])));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await pingMinecraft(server.address().port);
  assert.equal(result.status, 'online');
  assert.equal(result.players, 2);
  assert.equal(result.version, 'Paper 1.21');
});
test('open non-Minecraft port is not reported as confirmed', async t => {
  const server = net.createServer(socket => socket.once('data', () => {
    socket.write('hello');
    setTimeout(() => socket.destroy(), 50);
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await pingMinecraft(server.address().port)).status, 'possible');
});
test('process usage needs two samples and ignores unrelated Java processes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-proc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '123'));
  await fs.mkdir(path.join(root, '456'));
  const stat = ticks => {
    const fields = Array(22).fill('0');
    fields[0] = 'S'; fields[11] = String(ticks); fields[12] = '0'; fields[19] = '77';
    return '123 (java) ' + fields.join(' ');
  };
  await fs.writeFile(path.join(root, '123/cmdline'), '/data/data/com.termux/files/usr/bin/java\0-Xmx2G\0-jar\0server.jar\0');
  await fs.writeFile(path.join(root, '123/status'), 'Name:\tjava\nVmRSS:\t204800 kB\n');
  await fs.writeFile(path.join(root, '123/stat'), stat(100));
  await fs.writeFile(path.join(root, '456/cmdline'), '/data/data/com.termux/files/usr/bin/java\0-jar\0other.jar\0');
  await fs.writeFile(path.join(root, '456/stat'), stat(90));
  await fs.writeFile(path.join(root, '456/status'), 'VmRSS:\t100 kB\n');
  await fs.writeFile(path.join(root, 'stat'), 'cpu  1000 0 0 0\n');
  const probe = createMinecraftProbe({ procRoot: root, totalMemory: () => 1024 * 1024 * 1024,
    ping: async () => ({ status: 'online', detail: 'Minecraft confirmado' }) });
  let result = await probe();
  assert.equal(result.process.pid, 123);
  assert.equal(result.process.rssBytes, 204800 * 1024);
  assert.equal(result.process.memoryPercent, 19.5);
  assert.equal(result.process.cpuPercent, null);
  await fs.writeFile(path.join(root, '123/stat'), stat(110));
  await fs.writeFile(path.join(root, 'stat'), 'cpu  1100 0 0 0\n');
  result = await probe();
  assert.ok(result.process.cpuPercent > 0);
  assert.equal(result.candidateCount, 2);
  assert.equal(javaJar(Buffer.from('/usr/bin/python\0-jar\0server.jar\0')), null);
});
test('inaccessible process listing keeps the port result and does not invent resource use', async () => {
  const probe = createMinecraftProbe({ procRoot: path.join(os.tmpdir(), 'missing-minecraft-proc'),
    ping: async () => ({ status: 'offline', detail: 'Sem resposta' }) });
  const result = await probe();
  assert.equal(result.status, 'offline');
  assert.equal(result.process, null);
});
