const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDisk, parseProcesses, tailnetAddress, command } = require('../lib/collectors');

test('PM2 missing metrics remain unavailable while actual idle CPU and zero memory remain zero', () => {
  const entries = parseProcesses(JSON.stringify([
    { name:'missing',pm2_env:{status:'online'} },
    { name:'idle',pm2_env:{status:'online',pm_uptime:1000,restart_time:0},monit:{cpu:0,memory:0} },
    { name:'invalid',monit:{cpu:-1,memory:'1000'} }
  ]), 31000);
  assert.equal(entries[0].cpu,null);
  assert.equal(entries[0].memoryBytes,null);
  assert.equal(entries[0].uptimeSeconds,null);
  assert.equal(entries[1].cpu,0);
  assert.equal(entries[1].memoryBytes,0);
  assert.equal(entries[1].uptimeSeconds,30);
  assert.equal(entries[1].restarts,0);
  assert.equal(entries[2].cpu,null);
  assert.equal(entries[2].memoryBytes,null);
  assert.equal(parseProcesses('permission denied'),null);
  assert.equal(parseProcesses('{}'),null);
});
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
