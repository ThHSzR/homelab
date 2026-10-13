const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
async function ui(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'),
    { url: 'https://home.example', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.AbortSignal = AbortSignal; w.setInterval = () => 0;
  let states = { 'bom-dia': { state: 'offline', available: true }, minecraft: { state: 'online', available: true },
    'tailscale-userspace': { state: 'online', available: true } };
  let health = { timestamp: new Date().toISOString(), stale: false, history: [], recovery: { enabled: false, attempts: 0 },
    services: { 'bom-dia': { status: 'offline', manager: 'PM2' }, minecraft: { status: 'online', detail: 'Minecraft',
      process: { cpuPercent: null, cpuReason: 'getconf CLK_TCK indisponível.' } },
      'tailscale-userspace': { status: 'online', ip: '100.65.49.34', detail: 'PM2 · Running' } } };
  let failed = false, held = false, release;
  const posts = [];
  w.confirm = () => true;
  w.fetch = async (url, opts = {}) => {
    if (opts.method === 'POST') {
      posts.push({ url, opts });
      if (held) await new Promise(resolve => { release = resolve; });
      return new Response(JSON.stringify({ error: 'Falha PM2' }), { status: failed ? 503 : 202 });
    }
    if (url.startsWith('/api/services')) return new Response(JSON.stringify(states), { status: failed ? 401 : 200 });
    if (url.startsWith('/api/health')) return new Response(JSON.stringify(health), { status: failed ? 503 : 200 });
    if (url.startsWith('/api/modules')) return new Response('[]');
    return new Response('{}', { status: 503 });
  };
  w.eval(fs.readFileSync(path.join(root, 'public/insights.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'));
  await flush();
  return { w, posts, states, health, fail: () => { failed = true; }, hold: () => { held = true; }, release: () => { held = false; release(); } };
}
test('switches belong to existing service cards, Tailscale is split, refresh and watchdog outages preserve their identity', async t => {
  const f = await ui(t), d = f.w.document;
  const bom = d.querySelector('#health-card-bom-dia [role=switch]');
  const mc = d.querySelector('#health-card-minecraft [role=switch]');
  assert.ok(bom && mc); assert.equal(d.querySelectorAll('[role=switch]').length, 3);
  assert.equal(d.querySelector('#service-controls'), null);
  assert.equal(d.querySelectorAll('#tailscale-android [role=switch]').length, 0);
  assert.equal(d.querySelectorAll('#tailscale-termux [role=switch]').length, 1);
  assert.equal(mc.getAttribute('aria-checked'), 'true'); assert.equal(bom.getAttribute('aria-checked'), 'false');
  await f.w.health(); assert.equal(d.querySelector('#health-card-minecraft [role=switch]'), mc);
  assert.match(d.querySelector('#minecraft-cpu-reason').textContent, /CLK_TCK/);
  f.fail(); await f.w.health(); await f.w.updateControls();
  assert.equal(d.querySelector('#health-card-bom-dia [role=switch]'), bom); assert.equal(mc.disabled, true);
});
test('Minecraft stop requires confirmation, operation prevents competing clicks and errors are visible', async t => {
  const f = await ui(t), d = f.w.document;
  const mc = d.querySelector('#health-card-minecraft [role=switch]');
  f.w.confirm = () => false; mc.click(); await flush(); assert.equal(f.posts.length, 0);
  f.w.confirm = () => true; f.hold(); mc.click(); await flush();
  assert.equal(f.posts.length, 1); assert.equal(mc.disabled, true); assert.equal(mc.getAttribute('aria-busy'), 'true');
  d.querySelector('#health-card-bom-dia [role=switch]').click(); mc.click(); await flush();
  assert.equal(f.posts.length, 1);
  assert.deepEqual(JSON.parse(f.posts[0].opts.body), { action: 'stop' });
  assert.equal(f.posts[0].opts.headers['X-Homelab-Control'], '1');
  f.fail(); f.release(); await flush();
  assert.match(d.querySelector('#health-card-minecraft .control-error').textContent, /Falha PM2/);
});
test('API starting/stopping/unknown disables switches, confirmed offline moves thumb back and enables start', async t => {
  const f = await ui(t), d = f.w.document;
  const mc = d.querySelector('#health-card-minecraft [role=switch]');
  for (const state of ['starting', 'stopping', 'unknown']) {
    f.states.minecraft.state = state; await f.w.updateControls(); assert.equal(mc.disabled, true);
    assert.equal(mc.getAttribute('aria-busy'), String(state !== 'unknown'));
  }
  f.states.minecraft.state = 'offline'; await f.w.updateControls();
  assert.equal(mc.disabled, false); assert.equal(mc.getAttribute('aria-checked'), 'false');
  mc.click(); await flush(); assert.equal(JSON.parse(f.posts[0].opts.body).action, 'start');
  const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
  assert.match(css, /aria-checked="true"\] \.toggle-thumb \{ transform: translateX\(26px\)/);
});
