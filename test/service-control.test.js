const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createController, withServiceLock } = require('../lib/service-control');
const { createControlRouter, createAccessGuard } = require('../lib/control-api');
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
test('Access JWT signature, audience, expiration, issuer and admin authorization', async t => {
  const { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } = await import('jose');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://test.cloudflareaccess.com';
  const env = { CF_ACCESS_ISSUER: issuer, CF_ACCESS_AUD: 'dashboard', CONTROL_ADMIN_EMAILS: 'admin@example.com' };
  const url = await serve(t, createControlRouter({ guard: createAccessGuard(env, createLocalJWKSet({ keys: [await exportJWK(publicKey)] })),
    controller: { status: async () => ({ state: 'offline', available: true }) } }));
  async function token(email = 'admin@example.com', aud = 'dashboard', iss = issuer, exp = '2m', key = privateKey) {
    return new SignJWT({ email, type: 'app' }).setProtectedHeader({ alg: 'RS256' }).setSubject('user').setIssuedAt().setExpirationTime(exp).setIssuer(iss).setAudience(aud).sign(key);
  }
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' } })).status, 401);
  for (const jwt of [await token('admin@example.com', 'other'), await token('admin@example.com', 'dashboard', 'https://other.cloudflareaccess.com'), await token('admin@example.com', 'dashboard', issuer, '-1m'), await token('admin@example.com', 'dashboard', issuer, '2m', (await generateKeyPair('RS256')).privateKey)])
    assert.equal((await fetch(url, { headers: { 'Cf-Access-Jwt-Assertion': jwt } })).status, 401);
  assert.equal((await fetch(url, { headers: { 'Cf-Access-Jwt-Assertion': await token('reader@example.com') } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'Cf-Access-Jwt-Assertion': await token() } })).status, 200);
  const closed = await serve(t, createControlRouter({ guard: createAccessGuard({}) }));
  assert.equal((await fetch(closed)).status, 503);
});
test('POST requires exact origin, JSON, custom header and fixed service/action', async t => {
  let called = 0;
  const url = await serve(t, createControlRouter({ guard: (_, __, next) => next(), origin: 'https://home.example',
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

test('Minecraft uses the authenticated POST route, returns 202 and rejects injected commands', async t => {
  const actions = [];
  const url = await serve(t, createControlRouter({ guard: (_, __, next) => next(), origin: 'https://home.example',
    controller: { status: async () => ({state:'offline'}) },
    minecraft: { status: async () => ({state:'starting',available:true}), request: async action => { actions.push(action); return {state:'starting',accepted:true}; } } }));
  const headers = { Origin:'https://home.example', 'Content-Type':'application/json', 'X-Homelab-Control':'1' };
  const response = await fetch(url + '/minecraft', {method:'POST', headers, body:JSON.stringify({action:'start'})});
  assert.equal(response.status,202); assert.equal((await response.json()).accepted,true);
  const state = await (await fetch(url)).json(); assert.equal(state.minecraft.state,'starting');
  const bad = await fetch(url + '/minecraft', {method:'POST', headers, body:JSON.stringify({action:'stop',command:'kill -9'})});
  assert.equal(bad.status,400); assert.deepEqual(actions,['start']);
});
