const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createMinecraftController } = require('../lib/minecraft-control');
const { rcon } = require('../lib/minecraft-rcon');
const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-control-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'server.properties'), 'enable-rcon=true\nserver-ip=127.0.0.1\nrcon.port=25575\nrcon.password=' + 'a'.repeat(64), { mode: 0o600 });
  let running = true;
  const calls = [];
  const entry = { name: 'minecraft', pid: 123, pm_id: 4, pm2_env: { status: 'online', autorestart: false, pm_cwd: dir,
    pm_exec_path: path.join(dir, 'start.sh'), exec_interpreter: path.join(PREFIX, 'bin/bash'), exec_mode: 'fork_mode' } };
  const opts = { dir, enabled: true, alive: () => running,
    ping: async () => ({ status: running ? 'online' : 'offline' }),
    run: async args => {
      if (args[0] === 'jlist') return { ok: true, text: JSON.stringify([entry]) };
      calls.push(args.join(' '));
      if (args[0] === 'stop') { assert.equal(running, false); entry.pm2_env.status = 'stopped'; entry.pid = 0; }
      if (args[0] === 'start') { running = true; entry.pid = 123; entry.pm2_env.status = 'online'; }
      return { ok: true, text: '' };
    }, send: async (_, action) => { calls.push(action); if (action === 'stop') { running = false; entry.pid = 0; entry.pm2_env.status = 'stopped'; } }, ...overrides };
  return { c: createMinecraftController(opts), dir, entry, calls, opts, setRunning: value => { running = value; } };
}
test('Minecraft saves before stop, waits for exit and persists PM2 only afterward', async t => {
  const { c, dir, calls } = await fixture(t);
  assert.equal((await c.status()).state, 'online');
  assert.equal((await c.request('stop')).state, 'stopping');
  await c.settled();
  assert.deepEqual(calls, ['save', 'stop', 'stop 4', 'save']);
  assert.equal((await c.status()).state, 'offline');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, '.homelab-desired.json'))).desired, 'offline');
  await c.request('start'); await c.settled();
  assert.equal((await c.status()).state, 'online');
  assert.deepEqual(calls.slice(-2), ['start 4', 'save']);
});
test('RCON save failure never sends stop or PM2 kill and exposes no password', async t => {
  const { c, calls, dir } = await fixture(t, { send: async () => { throw new Error('secret password detail'); } });
  await c.request('stop'); await c.settled();
  assert.deepEqual(calls, []);
  const state = await c.status(); assert.equal(state.state, 'online');
  assert.ok(state.reason); assert.doesNotMatch(state.reason, /secret password/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, '.homelab-desired.json'))).desired, 'offline');
});
test('shutdown timeout never escalates to PM2 stop, and competing requests are blocked', async t => {
  let time = 0;
  const { c, calls } = await fixture(t, { send: async () => {}, now: () => time, sleep: async () => { time += 60000; } });
  await c.request('stop');
  await assert.rejects(c.request('start'), { status: 409 });
  await c.settled(); assert.deepEqual(calls, []);
  assert.match((await c.status()).reason, /Nenhum kill/);
});
test('unsafe PM2 configuration, wrong script, public RCON or malformed state fail closed', async t => {
  const { c, entry, calls, dir } = await fixture(t);
  entry.pm2_env.autorestart = true;
  assert.equal((await c.status()).available, false);
  await assert.rejects(c.request('stop')); assert.deepEqual(calls, []);
  entry.pm2_env.autorestart = false; entry.pm2_env.pm_exec_path = '/other/start.sh';
  await assert.rejects(c.request('start')); assert.deepEqual(calls, []);
  entry.pm2_env.pm_exec_path = path.join(dir, 'start.sh');
  await fs.writeFile(path.join(dir, 'server.properties'), 'enable-rcon=true\nserver-ip=\nrcon.port=25575\nrcon.password=' + 'a'.repeat(64), {mode:0o600});
  await assert.rejects(c.request('stop')); assert.deepEqual(calls, []);
});
test('new controller reconciles persisted manual stop after a resurrection, never autostarts', async t => {
  const f = await fixture(t);
  await f.c.request('stop'); await f.c.settled();
  f.setRunning(true); f.entry.pid = 123; f.entry.pm2_env.status = 'online'; f.calls.length = 0;
  const reboot = createMinecraftController(f.opts);
  await reboot.reconcile(); await reboot.settled();
  assert.equal((await reboot.status()).state, 'offline');
  assert.deepEqual(f.calls, ['save', 'stop', 'stop 4', 'save']);
  f.calls.length = 0; await reboot.reconcile(); assert.deepEqual(f.calls, []);
  await fs.writeFile(path.join(f.dir, '.homelab-desired.json'), '{');
  await reboot.reconcile(); assert.match((await reboot.status()).reason, /inválido/);
  assert.deepEqual(f.calls, []);
});
test('RCON authenticates, handles fragmented packets, and only permits save/stop', async t => {
  const commands = [];
  function packet(id,type,text) { const b=Buffer.from(text); const p=Buffer.alloc(b.length+14); p.writeInt32LE(b.length+10,0);p.writeInt32LE(id,4);p.writeInt32LE(type,8);b.copy(p,12);return p; }
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    let buffer=Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=4 && buffer.length>=buffer.readInt32LE(0)+4) {
        const len=buffer.readInt32LE(0), p=buffer.subarray(0,len+4);buffer=buffer.subarray(len+4);
        const id=p.readInt32LE(4),type=p.readInt32LE(8),text=p.subarray(12,len+2).toString();
        if(type===3) socket.write(packet(text==='correct'?id:-1,2,''));
        else { commands.push(text); const reply=packet(id,0,'Saved the game');socket.write(reply.subarray(0,5));socket.write(reply.subarray(5)); }
      }
    });
  });
  server.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const config={port:server.address().port,password:'correct'};
  await rcon(config,'save'); await rcon(config,'stop');
  // stop resolves after sending; wait for the fixture to observe its TCP packet.
  for(let i=0;commands.length<2 && i<100;i++) await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(commands,['save-all flush','stop']);
  await assert.rejects(rcon({...config,password:'wrong'},'save'), /Autenticação/);
  await assert.rejects(rcon(config,'kill'), /inválida/);
});
