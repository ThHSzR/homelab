'use strict';

const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const { execFile } = require('node:child_process');
const express = require('express');

const COOLDOWN_MS = 10000;

function normalizeMac(value) {
  const hex = String(value || '').replace(/[:-]/g, '');
  if (!/^[a-f0-9]{12}$/i.test(hex) || (parseInt(hex.slice(0, 2), 16) & 1)) return null;
  return hex.toLowerCase().match(/../g).join(':');
}

function ipv4Number(ip) {
  if (net.isIP(ip) !== 4) return null;
  return ip.split('.').reduce((value, part) => ((value * 256) + Number(part)) >>> 0, 0);
}
function ipFromNumber(number) {
  return [24, 16, 8, 0].map(shift => (number >>> shift) & 255).join('.');
}
function privateIPv4(ip) {
  const value = ipv4Number(ip);
  if (value == null) return false;
  const a = value >>> 24, b = (value >>> 16) & 255;
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function prefixFor(address) {
  const suffix = /\/(\d{1,2})$/.exec(address.cidr || '');
  if (suffix) return Number(suffix[1]);
  const mask = ipv4Number(address.netmask);
  if (mask == null) return null;
  const bits = mask.toString(2).padStart(32, '0');
  return /^1*0*$/.test(bits) ? bits.indexOf('0') < 0 ? 32 : bits.indexOf('0') : null;
}

function readWolConfig(env = process.env, interfaces = os.networkInterfaces()) {
  const result = { ready: false, configured: false, reason: '', interface: env.WOL_INTERFACE || 'wlan0',
    localIp: null, broadcast: null, port: 9, targetIp: null, mac: null };
  const rawMac = String(env.WOL_DESKTOP_MAC || '').trim();
  if (!rawMac) { result.reason = 'Defina WOL_DESKTOP_MAC no PM2.'; return result; }
  result.mac = normalizeMac(rawMac);
  if (!result.mac) { result.reason = 'WOL_DESKTOP_MAC inválido (use a MAC Ethernet unicast).'; return result; }
  result.configured = true;
  const port = env.WOL_PORT == null || env.WOL_PORT === '' ? 9 : Number(env.WOL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    result.reason = 'WOL_PORT deve estar entre 1 e 65535.'; return result;
  }
  result.port = port;
  const candidates = interfaces[result.interface] || [];
  const address = candidates.find(item => !item.internal && (item.family === 'IPv4' || item.family === 4) &&
    privateIPv4(item.address));
  if (!address) { result.reason = 'Interface LAN ' + result.interface + ' sem IPv4 privado; verifique o Wi-Fi do A30.'; return result; }
  const prefix = prefixFor(address);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) {
    result.reason = 'Máscara IPv4 da interface LAN indisponível ou inválida.'; return result;
  }
  result.localIp = address.address;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const ip = ipv4Number(address.address);
  result.broadcast = ipFromNumber((ip | ~mask) >>> 0);
  const suppliedBroadcast = String(env.WOL_BROADCAST || '').trim();
  if (suppliedBroadcast && suppliedBroadcast !== result.broadcast) {
    result.reason = 'WOL_BROADCAST deve corresponder ao broadcast da interface ' + result.interface + ' (' + result.broadcast + ').';
    return result;
  }
  const target = String(env.WOL_DESKTOP_IP || '').trim();
  if (target) {
    const targetNumber = ipv4Number(target);
    if (targetNumber == null || (targetNumber & mask) !== (ip & mask) ||
        targetNumber === (ip & mask) || targetNumber === ((ip | ~mask) >>> 0)) {
      result.reason = 'WOL_DESKTOP_IP deve ser um IP válido de host na mesma LAN do A30.';
      return result;
    }
    result.targetIp = target;
  }
  result.ready = true;
  return result;
}

function magicPacket(mac) {
  const parsed = normalizeMac(mac);
  if (!parsed) throw new Error('Endereço MAC inválido.');
  const bytes = Buffer.from(parsed.replace(/:/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

// O envio UDP confirma apenas o despacho do pacote, nunca que o Windows inicializou.
function sendMagicPacket(config, socketFactory = () => dgram.createSocket('udp4')) {
  return new Promise((resolve, reject) => {
    const socket = socketFactory();
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeListener('error', fail);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve();
    };
    const fail = error => finish(error);
    const timeout = setTimeout(() => fail(new Error('Tempo esgotado ao enviar WOL.')), 3000);
    socket.once('error', fail);
    try {
      socket.bind(0, config.localIp, () => {
        try {
          socket.setBroadcast(true);
          socket.send(magicPacket(config.mac), config.port, config.broadcast, finish);
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
}

function probeDesktop(ip) {
  return new Promise(resolve => {
    execFile('ping', ['-n', '-c', '1', '-W', '1', ip], { timeout: 2000 }, error => resolve(!error));
  });
}

function createWolRouter({ env = process.env, interfaces = os.networkInterfaces,
  send = sendMagicPacket, probe = probeDesktop, now = () => Date.now(),
  audit = event => console.log('[wol]', JSON.stringify(event)) } = {}) {
  const router = express.Router();
  let sending = false, lastWakeAt = null;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/status', async (req, res) => {
    const config = readWolConfig(env, interfaces());
    let state = 'unknown';
    if (config.ready && config.targetIp) {
      try { state = await probe(config.targetIp) ? 'online' : 'unverified'; } catch { state = 'unverified'; }
    }
    res.json({ configured: config.configured, ready: config.ready, reason: config.reason || null,
      state, probeConfigured: Boolean(config.targetIp), interface: config.interface,
      localIp: config.localIp, broadcast: config.broadcast, lastWakeAt: lastWakeAt && new Date(lastWakeAt).toISOString() });
  });
  router.post('/wake', async (req, res) => {
    const config = readWolConfig(env, interfaces());
    if (!config.ready) return res.status(503).json({ error: config.reason });
    if (sending) return res.status(409).json({ error: 'Já existe um envio WOL em andamento.' });
    if (lastWakeAt != null && now() - lastWakeAt < COOLDOWN_MS)
      return res.status(429).json({ error: 'Aguarde 10 segundos antes de repetir o comando.' });
    sending = true;
    try {
      await send(config);
      lastWakeAt = now();
      audit({ device: 'thiago-pc', action: 'wake', result: 'packet-sent', interface: config.interface });
      res.status(202).json({ accepted: true, state: 'sent', requestedAt: new Date(lastWakeAt).toISOString(),
        message: 'Magic Packet enviado; a inicialização do computador ainda não foi confirmada.' });
    } catch (error) {
      audit({ device: 'thiago-pc', action: 'wake', result: 'failed', error: error.code || 'send-error' });
      res.status(503).json({ error: 'Não foi possível enviar o Magic Packet pela rede local.' });
    } finally { sending = false; }
  });
  return router;
}

module.exports = { normalizeMac, readWolConfig, magicPacket, sendMagicPacket, createWolRouter, COOLDOWN_MS };
