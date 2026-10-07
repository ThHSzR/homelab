const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDisk, tailnetAddress, command } = require('../lib/collectors');
test('disk reports byte units and rejects malformed output', () => {
  assert.deepEqual(parseDisk('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/data 1000 250 750 25% /data'),
    { totalBytes: 1024000, usedBytes: 256000, availableBytes: 768000, percent: 25 });
  assert.equal(parseDisk('permission denied'), null);
});
test('tailnet detection excludes unrelated 100.x and down interfaces', () => {
  const iface = (ip, flags = ['UP']) => ({ ifname: 'tun1', flags, addr_info: [{ family: 'inet', local: ip }] });
  assert.equal(tailnetAddress([iface('100.1.2.3')]), null);
  assert.equal(tailnetAddress([iface('100.66.241.113', [])]), null);
  assert.equal(tailnetAddress([iface('100.66.241.113')]).ip, '100.66.241.113');
});
test('hung external collector is bounded', async () => {
  const start = Date.now();
  const result = await command(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], 1);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - start < 4000);
});
