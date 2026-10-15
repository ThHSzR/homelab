const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('network, devices, ports, traffic and bounded logs render as text from fixed APIs', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'),
    { url: 'https://homelab.thsouza.eng.br', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  w.AbortSignal = AbortSignal; w.setInterval = () => 0;
  const stamp = new Date().toISOString();
  const network = { timestamp: stamp, stale: false, lan: { interface: 'wlan0', ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' },
    connectivity: { gateway: { status: 'online', latencyMs: 2, lossPercent: 0 }, internet: { status: 'online', latencyMs: 25, lossPercent: 0 },
      dns: { status: 'online', latencyMs: 10 }, web: { status: 'online', latencyMs: 32 } },
    history: [{ timestamp: stamp, gatewayLatencyMs: 2, gatewayLossPercent: 0, internetLatencyMs: 25,
      internetLossPercent: 0, dnsLatencyMs: 10, rxBytesPerSec: 1024, txBytesPerSec: 512 }],
    devices: [{ ip: '192.168.1.1', hostname: '<router>', mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Fabricante', status: 'online', lastSeen: stamp }],
    ports: [{ label: 'Minecraft', host: '127.0.0.1', port: 25565, status: 'online', latencyMs: 1 }],
    traffic: [{ interface: 'wlan0', kind: 'Wi-Fi', rxBytes: 2048, txBytes: 1024, rxBytesPerSec: 1024, txBytesPerSec: 512 }] };
  w.fetch = async url => {
    if (url === '/api/network') return new Response(JSON.stringify(network));
    if (url === '/api/logs/sources') return new Response(JSON.stringify([{ id: 'playit', available: true }]));
    if (url.startsWith('/api/logs/all')) return new Response(JSON.stringify({ text: '<script>não executar</script>' }));
    return new Response('{}', { status: 404 });
  };
  w.eval(fs.readFileSync(path.join(root, 'public/network.js'), 'utf8'));
  await flush();
  assert.match(d.querySelector('#network-overview').textContent, /Gateway/);
  assert.equal(d.querySelectorAll('#network-history .network-bar').length, 1);
  assert.equal(d.querySelectorAll('#gateway-history .network-bar').length, 1);
  assert.equal(d.querySelectorAll('#dns-history .network-bar').length, 1);
  assert.equal(d.querySelectorAll('#traffic-sent-history .network-bar').length, 1);
  assert.equal(d.querySelector('#devices-list tr td:nth-child(2)').textContent, '192.168.1.1');
  assert.equal(d.querySelector('#devices-list script'), null);
  assert.match(d.querySelector('#ports-list').textContent, /25565/);
  assert.match(d.querySelector('#traffic-list').textContent, /1 KB\/s/);
  assert.equal(d.querySelector('#logs-content').textContent, '<script>não executar</script>');
  assert.equal(d.querySelector('#logs-content script'), null);
});
