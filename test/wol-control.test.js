'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { normalizeMac, magicPacket, readWolConfig, createWolRouter } = require('../lib/wol-control');

const interfaces = () => ({ wlan0: [{ family: 'IPv4', internal: false,
  address: '192.168.10.21', netmask: '255.255.255.0', cidr: '192.168.10.21/24' }] });
const env = { WOL_DESKTOP_MAC: '00:11:22:33:44:55', WOL_DESKTOP_IP: '192.168.10.50' };

async function withRouter(t, options) {
  const app = express();
  app.use('/api/devices/desktop', createWolRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port + '/api/devices/desktop';
}

test('magic packet is 6 sync bytes plus MAC repeated exactly 16 times', () => {
  assert.equal(normalizeMac('00-11-22-33-44-55'), '00:11:22:33:44:55');
  assert.equal(normalizeMac('001122334455'), '00:11:22:33:44:55');
  assert.equal(normalizeMac('01:11:22:33:44:55'), null, 'multicast MAC not accepted');
  const packet = magicPacket('00:11:22:33:44:55');
  assert.equal(packet.length, 102);
  assert.equal(packet.subarray(0, 6).toString('hex'), 'ffffffffffff');
  assert.equal(packet.subarray(6).toString('hex'), '001122334455'.repeat(16));
});

test('WOL requires a valid MAC and LAN interface, derives directed broadcast', () => {
  assert.match(readWolConfig({}, interfaces()).reason, /WOL_DESKTOP_MAC/);
  assert.equal(readWolConfig({ WOL_DESKTOP_MAC: 'bad' }, interfaces()).ready, false);
  assert.equal(readWolConfig(env, {}).ready, false);
  const config = readWolConfig(env, interfaces());
  assert.equal(config.ready, true);
  assert.equal(config.broadcast, '192.168.10.255');
  assert.equal(config.localIp, '192.168.10.21');
  assert.equal(config.port, 9);
  assert.equal(config.targetIp, '192.168.10.50');
  assert.equal(readWolConfig({ ...env, WOL_BROADCAST: '192.168.11.255' }, interfaces()).ready, false);
  assert.equal(readWolConfig({ ...env, WOL_DESKTOP_IP: '10.0.0.2' }, interfaces()).ready, false);
  assert.equal(readWolConfig({ ...env, WOL_PORT: '0' }, interfaces()).ready, false);
});

test('GET is read-only and POST reports sent, never reports PC started', async t => {
  const deliveries = [];
  let clock = Date.now();
  const base = await withRouter(t, { env, interfaces, now: () => clock, probe: async () => false,
    send: async config => deliveries.push(config), audit: () => {} });
  const status = await (await fetch(base + '/status')).json();
  assert.equal(status.ready, true);
  assert.equal(status.state, 'unverified');
  assert.equal(status.broadcast, '192.168.10.255');
  const sent = await fetch(base + '/wake', { method: 'POST' });
  assert.equal(sent.status, 202);
  assert.match((await sent.json()).message, /não foi confirmada/);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].mac, '00:11:22:33:44:55');
  assert.equal((await fetch(base + '/wake', { method: 'POST' })).status, 429);
  clock += 10000;
  assert.equal((await fetch(base + '/wake', { method: 'POST' })).status, 202);
  assert.equal(deliveries.length, 2);
});

test('unconfigured, failed and overlapping WOL requests fail closed', async t => {
  const missing = await withRouter(t, { env: {}, interfaces, send: () => { throw Error('must not send'); } });
  assert.equal((await fetch(missing + '/wake', { method: 'POST' })).status, 503);

  let resume;
  const slow = await withRouter(t, { env, interfaces, send: () => new Promise(resolve => { resume = resolve; }), audit: () => {} });
  const first = fetch(slow + '/wake', { method: 'POST' });
  for (let attempt = 0; !resume && attempt < 30; attempt++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(resume, 'first packet dispatch started');
  assert.equal((await fetch(slow + '/wake', { method: 'POST' })).status, 409);
  resume();
  assert.equal((await first).status, 202);

  const failing = await withRouter(t, { env, interfaces, send: async () => { throw Error('EACCES'); }, audit: () => {} });
  const response = await fetch(failing + '/wake', { method: 'POST' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Não foi possível enviar/);
});
