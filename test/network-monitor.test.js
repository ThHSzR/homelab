const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createNetworkMonitor, readNetwork, selectLan, parseGateway, parsePing, parseTraffic,
  hostsForRound, privateLan } = require('../lib/network-monitor');

test('LAN selection and route parsing reject public, VPN and oversized discovery scopes', () => {
  const interfaces = [{ ifname: 'tun0', flags: ['UP'], addr_info: [{ family: 'inet', local: '10.0.0.4', prefixlen: 24 }] },
    { ifname: 'wlan0', flags: ['UP'], addr_info: [{ family: 'inet', local: '192.168.1.10', prefixlen: 24 }] }];
  const lan = selectLan(interfaces);
  assert.equal(lan.ip, '192.168.1.10');
  assert.equal(parseGateway('1.1.1.1 via 192.168.1.1 dev wlan0 src 192.168.1.10', lan), '192.168.1.1');
  assert.equal(parseGateway('1.1.1.1 via 10.0.0.1 dev wlan0', lan), null);
  assert.equal(privateLan('100.65.49.34'), false);
  assert.equal(hostsForRound({ ...lan, prefix: 16 }, 0, 64).length, 0);
  assert.deepEqual(hostsForRound(lan, 252, 4), ['192.168.1.253', '192.168.1.254', '192.168.1.1', '192.168.1.2']);
});
test('ping loss and interface rate use real counters without inventing missing data', () => {
  const ping = parsePing('3 packets transmitted, 2 received, 33% packet loss\nrtt min/avg/max/mdev = 1.0/2.5/4.0/1.0 ms');
  assert.equal(ping.status, 'online'); assert.equal(ping.lossPercent, 33); assert.equal(ping.latencyMs, 2.5);
  assert.equal(parsePing('permission denied').status, 'unknown');
  const links = [{ ifname: 'wlan0', flags: ['UP'], stats64: { rx: { bytes: 2500 }, tx: { bytes: 4000 } } }];
  assert.equal(parseTraffic(links, [{ interface: 'wlan0', rxBytes: 1000, txBytes: 1000 }], 5)[0].rxBytesPerSec, 300);
  assert.equal(parseTraffic(links, [{ interface: 'wlan0', rxBytes: 3000, txBytes: 1000 }], 5)[0].rxBytesPerSec, null);
});
test('bounded scans persist devices, history and measured traffic while leaving absent hosts unconfirmed', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'network-monitor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let current = Date.parse('2026-10-15T12:00:00Z'), rx = 1000, tx = 2000;
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    if (file === 'ping') return { ok: true, text: args.at(-1) === '192.168.1.1' || args.at(-1) === '1.1.1.1' ?
      '1 packets transmitted, 1 received, 0% packet loss\nrtt min/avg/max/mdev = 1/2/3/1 ms' :
      '1 packets transmitted, 0 received, 100% packet loss' };
    if (args[0] === 'route') return { ok: true, text: '1.1.1.1 via 192.168.1.1 dev wlan0 src 192.168.1.10' };
    if (args[1] === 'addr') return { ok: true, text: JSON.stringify([{ ifname: 'wlan0', flags: ['UP'],
      addr_info: [{ family: 'inet', local: '192.168.1.10', prefixlen: 24 }] }]) };
    if (args.includes('neigh')) return { ok: true, text: '[{"dst":"192.168.1.1","lladdr":"8c:86:dd:6a:a3:88","state":["REACHABLE"]}]' };
    if (args.includes('link')) return { ok: true, text: JSON.stringify([{ ifname: 'wlan0', flags: ['UP'],
      stats64: { rx: { bytes: rx }, tx: { bytes: tx } } }]) };
    return { ok: false, text: '' };
  };
  const monitor = createNetworkMonitor({ dir, now: () => current, run, hostsPerRound: 2,
    lookup: async () => ({ address: '1.2.3.4' }), reverse: async () => ['router.lan'],
    vendorLookup: async () => ({ '8C86DD': 'Fabricante local' }),
    portCheck: async () => ({ status: 'online', latencyMs: 1 }),
    fetcher: async () => ({ status: 204, ok: true, body: { cancel: async () => {} } }) });
  const first = await monitor.tick();
  assert.equal(first.scan.checkedThisRound, 2);
  assert.equal(first.devices[0].ip, '192.168.1.1');
  assert.equal(first.devices[0].vendor, 'Fabricante local');
  assert.equal(first.traffic[0].rxBytesPerSec, null);
  assert.equal(first.ports.length, 8);
  current += 60000; rx += 6000; tx += 3000;
  const second = await monitor.tick();
  assert.equal(second.traffic[0].rxBytesPerSec, 100);
  assert.equal(second.history.length, 2);
  assert.equal(second.devices[0].status, 'recent');
  assert.equal((await readNetwork(dir)).devices[0].hostname, 'router.lan');
  assert.equal(calls.filter(([file]) => file === 'ping').length, 8);
});
