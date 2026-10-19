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

test('Cloudflare-protected dashboard API does not request a second local login', async t => {
  const url = await serve(t, createControlRouter({
    controller: { status: async () => ({ state: 'offline', available: true }) },
    minecraft: { status: async () => ({state: 'offline',available:true}) },
    tailscale: { status: async () => ({state: 'offline',available:true}) }
  }));
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json())['bom-dia'].state, 'offline');
});

test('POST accepts plain JSON and rejects arbitrary services, commands or actions', async t => {
  let called = 0;
  const url = await serve(t, createControlRouter({
    controller: { set: async () => { called++; return {state:'offline'}; }, status: async () => ({state:'offline'}) },
    minecraft: { status: async () => ({state:'unknown',available:false}) },
    tailscale: { status: async () => ({state:'unknown',available:false}) }
  }));
  const post = (id, body, contentType='application/json') => fetch(url+'/'+id, {
    method:'POST', headers:{'Content-Type':contentType},body:JSON.stringify(body)
  });
  assert.equal((await post('ssh',{action:'stop'})).status,400);
  assert.equal((await post('bom-dia',{action:'stop',command:'whoami'})).status,400);
  assert.equal((await post('bom-dia',{action:'restart'})).status,400);
  assert.equal((await post('bom-dia',{action:'stop'},'text/plain')).status,400);
  assert.equal((await post('bom-dia',{action:'stop'})).status,200);
  assert.equal(called,1);
});

test('Minecraft and userspace operations keep allowlist and in-flight lock without redundant Access JWT', async t => {
  let release; const pending=new Promise(resolve=>{release=resolve;});
  const calls=[];
  const url=await serve(t,createControlRouter({
    audit: event=>calls.push(event),
    minecraft: { request: async()=>({state:'stopping',accepted:true}), settled: ()=>pending, status:async()=>({state:'online',available:true}) },
    controller: { set:async()=>({state:'offline'}),status:async()=>({state:'offline'}) },
    tailscale: { set:async()=>({state:'offline'}),status:async()=>({state:'offline'}) }
  }));
  const post=(id,body={action:'stop'})=>fetch(url+'/'+id,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('tailscale-android')).status,400);
  assert.equal((await post('tailscale-userspace',{action:'stop',command:'kill -9'})).status,400);
  assert.equal((await post('minecraft')).status,202);
  assert.equal((await post('bom-dia')).status,409);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await post('tailscale-userspace')).status,200);
  assert.ok(calls.every(event=>!Object.hasOwn(event,'body')));
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

