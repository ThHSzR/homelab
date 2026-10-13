const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createController, withServiceLock } = require('../lib/service-control');
const { createControlRouter } = require('../lib/control-api');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'control-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('runit allowlist, persistent stop, restart and actual state verification', async t => {
  const dir = await fixture(t); let online = true; const calls = [];
  const controller = createController({ dir, run: async (file, args) => {
    calls.push([file, args]);
    if (args[0] === 'status') return { ok: true, text: online ? 'run: service' : 'down: service' };
    online = args.includes('up'); return { ok: true, text: '' };
  } });
  await assert.rejects(controller.set('delete'), { status: 400 });
  assert.equal((await controller.set('stop')).state, 'offline');
  await fs.access(path.join(dir, 'down'));
  online = true; await controller.reconcile(); assert.equal(online, false);
  assert.equal((await controller.set('start')).state, 'online');
  await assert.rejects(fs.access(path.join(dir, 'down')));
  assert.ok(calls.every(([file, args]) => file === 'sv' && args.at(-1) === dir));
});
test('cross-process lock prevents competing control and recovery', async t => {
  const dir = await fixture(t); let release;
  const pending = withServiceLock(dir, () => new Promise(resolve => { release = resolve; }));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(withServiceLock(dir, () => assert.fail('must not execute')), { status: 409 });
  release(); await pending;
});
test('failure preserves stop marker and releases transition, unknown blocks execution', async t => {
  const dir = await fixture(t); let state = 'run: service';
  const c = createController({ dir, run: async (_, args) => ({ ok: args[0] === 'status', text: args[0] === 'status' ? state : '' }) });
  await assert.rejects(c.set('stop'), { status: 503 });
  await fs.access(path.join(dir, 'down')); assert.equal((await c.status()).state, 'online');
  state = ''; await assert.rejects(c.set('start'), { status: 503 });
  await fs.access(path.join(dir, 'down'));
});
async function serve(t, router) {
  const app = express(); app.use('/api/services', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port + '/api/services';
}
test('local tunnel can read state without a second login; direct connections are refused', async t => {
  const controller = { status: async () => ({ state: 'offline', available: true }) };
  const url = await serve(t, createControlRouter({ controller }));
  assert.equal((await fetch(url)).status, 200);
  const direct = await serve(t, createControlRouter({ controller, localOnly: () => false }));
  assert.equal((await fetch(direct)).status, 403);
});
test('POST requires exact origin, JSON, custom header and fixed service/action', async t => {
  let called = 0;
  const url = await serve(t, createControlRouter({ origin: 'https://home.example',
    controller: { set: async () => { called++; return { state: 'offline' }; }, status: async () => ({}) } }));
  const headers = { Origin: 'https://home.example', 'Content-Type': 'application/json', 'X-Homelab-Control': '1', 'Sec-Fetch-Site': 'same-origin' };
  async function post(id, body = { action: 'stop' }, h = headers) { return fetch(url + '/' + id, { method: 'POST', headers: h, body: JSON.stringify(body) }); }
  assert.equal((await post('bom-dia', undefined, { ...headers, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('bom-dia', undefined, { ...headers, 'X-Homelab-Control': '' })).status, 403);
  assert.equal((await post('bom-dia', undefined, { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('bom-dia', undefined, { ...headers, 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await post('ssh')).status, 400);
  assert.equal((await post('bom-dia', { action: 'stop', command: 'whoami' })).status, 400);
  assert.equal((await post('bom-dia', { action: 'restart' })).status, 400);
  assert.equal((await post('minecraft')).status, 409);
  assert.equal(called, 0);
  assert.equal((await post('bom-dia')).status, 200); assert.equal(called, 1);
});

test('in-flight control reports transition and refuses another action until completion', async t => {
  const dir = await fixture(t); let online = true; let release;
  const c = createController({ dir, run: async (_, args) => {
    if (args[0] === 'status') return { ok: true, text: online ? 'run: service' : 'down: service' };
    await new Promise(resolve => { release = resolve; }); online = false;
    return { ok: true, text: '' };
  } });
  const stopping = c.set('stop');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await c.status()).state, 'stopping');
  await assert.rejects(c.set('start'), { status: 409 });
  await fs.access(path.join(dir, 'down'));
  release(); assert.equal((await stopping).state, 'offline');
});

test('Minecraft uses the same-origin POST route, returns 202 and rejects injected commands', async t => {
  const actions = [];
  const url = await serve(t, createControlRouter({ origin: 'https://home.example',
    controller: { status: async () => ({state:'offline'}) },
    minecraft: { status: async () => ({state:'starting',available:true}), request: async action => { actions.push(action); return {state:'starting',accepted:true}; } } }));
  const headers = { Origin:'https://home.example', 'Content-Type':'application/json', 'X-Homelab-Control':'1' };
  const response = await fetch(url + '/minecraft', {method:'POST', headers, body:JSON.stringify({action:'start'})});
  assert.equal(response.status,202); assert.equal((await response.json()).accepted,true);
  const state = await (await fetch(url)).json(); assert.equal(state.minecraft.state,'starting');
  const bad = await fetch(url + '/minecraft', {method:'POST', headers, body:JSON.stringify({action:'stop',command:'kill -9'})});
  assert.equal(bad.status,400); assert.deepEqual(actions,['start']);
});

test('userspace POST uses allowlist, rejects Android/watchdog, bounds bodies, rate limits and audits without request secrets', async t => {
  const events = [], actions = [];
  const url = await serve(t, createControlRouter({
    origin: 'https://home.example', actionLimit: 2, audit: event => events.push(event),
    tailscale: { set: async action => { actions.push(action); return { state: 'offline' }; } } }));
  const headers = { Origin: 'https://home.example', 'Content-Type': 'application/json', 'X-Homelab-Control': '1' };
  const post = (id, body) => fetch(url + '/' + id, { method: 'POST', headers, body });
  for (const id of ['tailscale-android', 'homelab-watchdog', 'tailscale', 'ssh'])
    assert.equal((await post(id, '{"action":"stop"}')).status, 400);
  assert.equal((await post('tailscale-userspace', JSON.stringify({ action: 'stop', secret: 'x'.repeat(2048) }))).status, 400);
  assert.equal((await post('tailscale-userspace', '{')).status, 400);
  assert.equal((await post('tailscale-userspace', '{"action":"stop"}')).status, 200);
  assert.equal((await post('tailscale-userspace', '{"action":"start"}')).status, 200);
  assert.equal((await post('tailscale-userspace', '{"action":"start"}')).status, 429);
  assert.deepEqual(actions, ['stop', 'start']);
  assert.ok(events.every(event => !Object.hasOwn(event, 'subject') && !Object.hasOwn(event, 'body')));
  const limited = await serve(t, createControlRouter({ requestLimit: 1,
    controller: { status: async () => ({}) }, minecraft: { status: async () => ({}) }, tailscale: { status: async () => ({}) } }));
  assert.equal((await fetch(limited)).status, 200); assert.equal((await fetch(limited)).status, 429);
});

test('API global operation lock blocks another service until Minecraft background operation settles', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  let called = 0;
  const url = await serve(t, createControlRouter({ origin: 'https://home.example', audit: () => {},
    minecraft: { request: async () => ({ state: 'stopping' }), settled: () => pending, status: async () => ({ state: 'offline' }) },
    controller: { set: async () => { called++; return {}; } } }));
  const headers = { Origin: 'https://home.example', 'Content-Type': 'application/json', 'X-Homelab-Control': '1' };
  const post = id => fetch(url + '/' + id, { method: 'POST', headers, body: '{"action":"stop"}' });
  assert.equal((await post('minecraft')).status, 202);
  assert.equal((await post('bom-dia')).status, 409); assert.equal(called, 0);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post('bom-dia')).status, 200); assert.equal(called, 1);
});
