'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const sample = () => ({ installed: true, paused: false, schedule: { enabled: false }, mail: { enabled: false },
  worker: { state: 'online', stale: false }, books: [{ id: '20261023-af712fe0', status: 'escrevendo' }],
  book: { id: '20261023-af712fe0', title: '<img src=x onerror=alert(1)>', author: 'Jerry White', status: 'escrevendo', chapters: 8,
    step: 'chapter-01-scene-1', attempts: 1, progress: { completed: 12, total: 53, percent: 22, written: 0, scenes: 0, plans: 8 } },
  inference: { elapsedSeconds: 70, rssMib: 980, peakRssMib: 1000, context: 3072, threads: 2 },
  profile: { model: 'model.gguf', maxRssMib: 1072, reserveMib: 384 },
  artifacts: [{ name: '20261023-af712fe0-amostra.epub', partial: true, url: 'https://evil.example' }],
  cover: { name: '20261023-af712fe0-capa.jpg', version: 1234, url: 'https://evil.example' } });

async function ui(t, data = sample()) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'),
    { url: 'https://homelab.example', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  let failed = false;
  w.AbortSignal = AbortSignal;
  w.setInterval = () => 0;
  w.fetch = async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    if (failed) throw new Error('network');
    return new Response(JSON.stringify(url.includes('/logs') ? { text: '<script>secret()</script>\nLog real.' } : data));
  };
  w.eval(fs.readFileSync(path.join(root, 'public/kindle-writer.js'), 'utf8'));
  await flush();
  return { w, calls, fail: () => { failed = true; }, data };
}

test('monitor renders real progress and uses text nodes and fixed local EPUB links', async t => {
  const { w, calls } = await ui(t), d = w.document;
  assert.match(d.getElementById('kw-state').textContent, /Capítulo 1 · cena 1\/2/);
  assert.equal(d.getElementById('kw-chapters').textContent, '0/8');
  assert.equal(d.getElementById('kw-progress').value, 22);
  assert.equal(d.getElementById('kw-title').querySelector('img'), null);
  assert.match(d.getElementById('kw-inference').textContent, /1 min 10 s/);
  assert.match(d.getElementById('kw-resources').textContent, /980 MiB/);
  assert.equal(d.querySelector('#kw-artifacts a').getAttribute('href'), '/api/kindle-writer/books/20261023-af712fe0-amostra.epub');
  assert.equal(d.getElementById('kw-cover').hidden, false);
  assert.equal(d.getElementById('kw-cover-image').getAttribute('src'), '/api/kindle-writer/covers/20261023-af712fe0-capa.jpg?v=1234');
  assert.equal(d.getElementById('kw-author').textContent, 'Jerry White');
  assert.equal(calls.some(c => c.url.includes('/logs')), false);
  d.getElementById('kw-log-details').open = true;
  d.getElementById('kw-log-details').dispatchEvent(new w.Event('toggle'));
  await flush();
  assert.match(d.getElementById('kw-log-content').textContent, /Log real/);
  assert.equal(d.getElementById('kw-log-content').querySelector('script'), null);
  assert.ok(calls.every(c => c.method === 'GET'));
});

test('failures invalidate live readings and do not keep stale download actions', async t => {
  const { w, fail } = await ui(t), d = w.document;
  fail();
  d.getElementById('kw-refresh').click();
  await flush();
  assert.match(d.getElementById('kw-state').textContent, /desatualizados/);
  assert.equal(d.querySelector('#kw-artifacts a'), null);
  assert.equal(d.getElementById('kw-cover').hidden, true);
  assert.doesNotMatch(d.getElementById('kw-resources').textContent, /980/);
});

test('explicitly unlimited RSS is distinguished from unavailable telemetry', async t => {
  const data = sample();
  data.profile.maxRssMib = null;
  data.profile.rssLimitDisabled = true;
  assert.match((await ui(t, data)).w.document.getElementById('kw-resources').textContent, /Sem teto configurado/);
  data.profile.rssLimitDisabled = false;
  assert.doesNotMatch((await ui(t, data)).w.document.getElementById('kw-resources').textContent, /Sem teto configurado/);
});

test('resource pauses, failed books and an absent installation are explicit', async t => {
  const paused = sample(); paused.paused = true;
  assert.match((await ui(t, paused)).w.document.getElementById('kw-state').textContent, /pausada/);
  const failed = sample(); failed.book.status = 'falhou'; failed.book.error = 'Memória insuficiente';
  const d = (await ui(t, failed)).w.document;
  assert.equal(d.getElementById('kw-error').hidden, false);
  assert.match(d.getElementById('kw-error').textContent, /Memória insuficiente/);
  const missing = (await ui(t, { installed: false, books: [], worker: { state: 'unmanaged' } })).w.document;
  assert.match(missing.getElementById('kw-title').textContent, /não instalado/);
  assert.equal(missing.getElementById('kw-book').disabled, true);
});
