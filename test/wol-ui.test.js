'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

async function ui(t, { ready = true, state = 'unknown', failed = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'),
    { url: 'https://homelab.example', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, posts = [];
  w.AbortSignal = AbortSignal;
  w.setInterval = () => 0;
  w.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      posts.push(url);
      return failed ? new Response(JSON.stringify({ error: 'Falha na rede local' }), { status: 503 }) :
        new Response(JSON.stringify({ accepted: true, state: 'sent' }), { status: 202 });
    }
    return new Response(JSON.stringify({ ready, state, probeConfigured: true, reason: ready ? null : 'MAC ausente',
      localIp: '192.168.10.21', broadcast: '192.168.10.255', interface: 'wlan0' }));
  };
  w.eval(fs.readFileSync(path.join(root, 'public/wol.js'), 'utf8'));
  await flush();
  return { w, posts };
}

test('WOL button dispatches only a fixed POST and labels it as unconfirmed', async t => {
  const { w, posts } = await ui(t);
  const button = w.document.getElementById('wol-wake');
  assert.equal(button.disabled, false);
  button.click();
  await flush();
  assert.deepEqual(posts, ['/api/devices/desktop/wake']);
  assert.match(w.document.getElementById('wol-result').textContent, /Aguardando confirmação/);
  assert.match(w.document.getElementById('wol-network').textContent, /192\.168\.10\.255/);
});

test('WOL button disabled when not configured or PC responds to ping', async t => {
  const missing = await ui(t, { ready: false });
  assert.equal(missing.w.document.getElementById('wol-wake').disabled, true);
  const online = await ui(t, { state: 'online' });
  assert.equal(online.w.document.getElementById('wol-wake').disabled, true);
  assert.match(online.w.document.getElementById('wol-state').textContent, /Ligado/);
});

test('WOL send failures surface in card without claiming boot', async t => {
  const { w } = await ui(t, { failed: true });
  w.document.getElementById('wol-wake').click();
  await flush();
  assert.match(w.document.getElementById('wol-result').textContent, /Falha na rede local/);
  assert.doesNotMatch(w.document.getElementById('wol-result').textContent, /Pacote enviado/);
});
