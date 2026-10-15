const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const dns = require('node:dns/promises');
const { performance } = require('node:perf_hooks');
const { command } = require('./collectors');

const INTERVAL = 60000;
const HISTORY = 120;
const STATE_DIR = process.env.WATCHDOG_STATE_DIR || path.join(os.homedir(), 'services/state');
const INTERNET_HOST = '1.1.1.1';
const DNS_HOST = 'connectivitycheck.gstatic.com';
const WEB_URL = 'https://connectivitycheck.gstatic.com/generate_204';

function ipv4Number(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n, p) => (n * 256 + Number(p)) >>> 0, 0);
}
function numberIpv4(value) { return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.'); }
function privateLan(ip) {
  const n = ipv4Number(ip);
  if (n == null) return false;
  const a = n >>> 24, b = (n >>> 16) & 255;
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function selectLan(interfaces) {
  if (!Array.isArray(interfaces)) return null;
  for (const item of interfaces) {
    if (!/^wlan\d+$/.test(item.ifname || '') || !item.flags?.includes('UP')) continue;
    const address = item.addr_info?.find(a => a.family === 'inet' && privateLan(a.local));
    if (address && Number.isInteger(address.prefixlen) && address.prefixlen >= 16 && address.prefixlen <= 30)
      return { interface: item.ifname, ip: address.local, prefix: address.prefixlen };
  }
  return null;
}
function sameSubnet(a, b, prefix) {
  const x = ipv4Number(a), y = ipv4Number(b);
  if (x == null || y == null) return false;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (x & mask) === (y & mask);
}
function parseGateway(text, lan) {
  const match = /\bvia\s+(\d+\.\d+\.\d+\.\d+)\s+dev\s+(\S+)/.exec(text || '');
  return match && match[2] === lan?.interface && sameSubnet(match[1], lan.ip, lan.prefix) ? match[1] : null;
}
function parsePing(text) {
  const counts = /(\d+)\s+packets? transmitted,\s*(\d+)\s+(?:packets? )?received(?:,|\s)/i.exec(text || '');
  if (!counts) return { status: 'unknown', sent: 0, received: 0, lossPercent: null, latencyMs: null };
  const sent = Number(counts[1]), received = Number(counts[2]);
  const rtt = /(?:rtt|round-trip)\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*[\d.]+\/([\d.]+)/i.exec(text);
  return { status: received > 0 ? 'online' : 'offline', sent, received,
    lossPercent: sent ? Math.round((sent - received) / sent * 100) : null,
    latencyMs: rtt ? Number(rtt[1]) : null };
}
function parseTraffic(interfaces, previous, elapsedSeconds) {
  if (!Array.isArray(interfaces)) return [];
  return interfaces.filter(item => /^(?:wlan\d+|rmnet\d+|tun\d+)$/.test(item.ifname || '') &&
    item.flags?.includes('UP') && Number.isSafeInteger(item.stats64?.rx?.bytes) && Number.isSafeInteger(item.stats64?.tx?.bytes))
    .slice(0, 8).map(item => {
      const rxBytes = item.stats64.rx.bytes, txBytes = item.stats64.tx.bytes;
      const prior = previous?.find(p => p.interface === item.ifname);
      const valid = elapsedSeconds > 0 && prior && rxBytes >= prior.rxBytes && txBytes >= prior.txBytes;
      return { interface: item.ifname, kind: item.ifname.startsWith('wlan') ? 'Wi-Fi' : item.ifname.startsWith('rmnet') ? 'Rede móvel' : 'VPN',
        rxBytes, txBytes, rxBytesPerSec: valid ? Math.round((rxBytes - prior.rxBytes) / elapsedSeconds) : null,
        txBytesPerSec: valid ? Math.round((txBytes - prior.txBytes) / elapsedSeconds) : null };
    });
}
function tcpPort(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const started = performance.now();
    let done = false;
    const finish = status => {
      if (done) return;
      done = true; socket.destroy();
      resolve({ status, latencyMs: status === 'online' ? Math.round(performance.now() - started) : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('online'));
    socket.once('error', () => finish('offline'));
    socket.once('timeout', () => finish('offline'));
  });
}
function hostsForRound(lan, cursor, count) {
  if (!lan || lan.prefix !== 24) return [];
  const base = ipv4Number(lan.ip) & 0xffffff00;
  const hosts = [];
  for (let i = 0; i < count; i++) {
    const host = 1 + ((cursor + i) % 254);
    const ip = numberIpv4((base + host) >>> 0);
    if (ip !== lan.ip) hosts.push(ip);
  }
  return hosts;
}
function neighbors(entries, lan) {
  const values = new Map();
  if (!Array.isArray(entries)) return values;
  for (const item of entries) {
    if (typeof item.dst === 'string' && sameSubnet(item.dst, lan.ip, lan.prefix) &&
      /^[\da-f]{2}(?::[\da-f]{2}){5}$/i.test(item.lladdr || '') &&
      !item.state?.includes('FAILED')) values.set(item.dst, item.lladdr.toLowerCase());
  }
  return values;
}
async function readVendors(file = path.join(os.homedir(), 'services/network-oui.json')) {
  try {
    const values = JSON.parse(await fs.readFile(file, 'utf8'));
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  } catch { return {}; }
}
async function withTimeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
function createNetworkMonitor({ dir = STATE_DIR, now = Date.now, run = command,
  lookup = dns.lookup, reverse = dns.reverse, portCheck = tcpPort, fetcher = fetch,
  vendorLookup = readVendors, hostsPerRound = 64 } = {}) {
  let snapshot = null, busy = false;
  async function readPrevious() {
    if (snapshot) return snapshot;
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, 'network.json'), 'utf8'));
      snapshot = data && Array.isArray(data.history) && Array.isArray(data.devices) ? data : {};
    } catch { snapshot = {}; }
    return snapshot;
  }
  async function ping(host, count) {
    try { return parsePing((await run('ping', ['-n', '-c', String(count), '-W', '1', host], count + 2)).text); }
    catch { return parsePing(''); }
  }
  async function tick() {
    if (busy) return null;
    busy = true;
    try {
      const previous = await readPrevious();
      const timestamp = new Date(now()).toISOString();
      const interfaceResult = await run('ip', ['-j', 'addr'], 3);
      let lan = null;
      try { if (interfaceResult.ok) lan = selectLan(JSON.parse(interfaceResult.text)); } catch {}
      const routeResult = lan ? await run('ip', ['route', 'get', INTERNET_HOST], 3) : null;
      const gateway = lan && routeResult?.ok ? parseGateway(routeResult.text, lan) : null;
      const [gatewayPing, internetPing, dnsResult, webResult, linkResult] = await Promise.all([
        gateway ? ping(gateway, 3) : Promise.resolve({ status: 'unknown', lossPercent: null, latencyMs: null }),
        ping(INTERNET_HOST, 3),
        (async () => { const start = performance.now(); try {
          const address = (await withTimeout(lookup(DNS_HOST, { family: 4 }), 3000)).address;
          return { status: 'online', latencyMs: Math.round(performance.now() - start), address };
        } catch { return { status: 'offline', latencyMs: null, address: null }; } })(),
        (async () => { const start = performance.now(); try {
          const response = await fetcher(WEB_URL, { signal: AbortSignal.timeout(4000), redirect: 'error' });
          await response.body?.cancel();
          return { status: response.status === 204 ? 'online' : 'offline', httpStatus: response.status,
            latencyMs: Math.round(performance.now() - start) };
        } catch { return { status: 'offline', httpStatus: null, latencyMs: null }; } })(),
        run('ip', ['-j', '-s', 'link', 'show'], 3)
      ]);
      let links = [];
      try { if (linkResult.ok) links = JSON.parse(linkResult.text); } catch {}
      const elapsed = previous.timestamp ? (now() - Date.parse(previous.timestamp)) / 1000 : 0;
      const traffic = parseTraffic(links, previous.traffic, elapsed);
      const portTargets = [
        { id: 'ssh', label: 'SSH Termux', host: '127.0.0.1', port: 8022 },
        { id: 'dashboard', label: 'Dashboard', host: '127.0.0.1', port: Number(process.env.PORT || 3000) },
        { id: 'minecraft', label: 'Minecraft', host: '127.0.0.1', port: Number(process.env.MINECRAFT_PORT || 25565) },
        { id: 'access-https', label: 'Dashboard público · HTTPS', host: 'homelab.thsouza.eng.br', port: 443 },
        ...(gateway ? [22, 80, 443].map(port => ({ id: 'gateway-' + port, label: 'Gateway · :' + port, host: gateway, port })) : [])
      ];
      const ports = await Promise.all(portTargets.map(async target => ({ ...target, ...await portCheck(target.host, target.port) })));
      const apiStart = performance.now();
      try {
        const response = await fetcher(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`,
          { signal: AbortSignal.timeout(3000), redirect: 'error' });
        await response.body?.cancel();
        ports.push({ id: 'api', label: 'API interna · /healthz', host: '127.0.0.1', port: Number(process.env.PORT || 3000),
          status: response.ok ? 'online' : 'offline', latencyMs: Math.round(performance.now() - apiStart), httpStatus: response.status });
      } catch { ports.push({ id: 'api', label: 'API interna · /healthz', host: '127.0.0.1', port: Number(process.env.PORT || 3000), status: 'offline', latencyMs: null }); }
      const sameLan = previous.lan?.ip === lan?.ip && previous.lan?.prefix === lan?.prefix;
      const cursor = sameLan && Number.isInteger(previous.cursor) ? previous.cursor : 0;
      const scanHosts = hostsForRound(lan, cursor, Math.min(64, Math.max(1, hostsPerRound)));
      const found = new Map(sameLan ? previous.devices.map(d => [d.ip, d]) : []);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(8, scanHosts.length) }, async () => {
        while (next < scanHosts.length) {
          const ip = scanHosts[next++], result = await ping(ip, 1);
          const old = found.get(ip);
          if (result.status === 'online') found.set(ip, { ...old, ip, status: 'online', lastSeen: timestamp });
          else if (old) found.set(ip, { ...old, status: result.status === 'offline' ? 'offline' : old.status });
        }
      }));
      let neighborResult = null;
      if (lan) neighborResult = await run('ip', ['-j', 'neigh', 'show', 'dev', lan.interface], 3);
      let macs = new Map();
      try { if (neighborResult?.ok) macs = neighbors(JSON.parse(neighborResult.text), lan); } catch {}
      const vendors = await vendorLookup();
      const live = [...found.values()].filter(d => d.status === 'online' && d.lastSeen === timestamp);
      await Promise.all(live.slice(0, 16).map(async device => {
        device.mac = macs.get(device.ip) || device.mac || null;
        const prefix = device.mac?.replace(/:/g, '').slice(0, 6).toUpperCase();
        device.vendor = typeof vendors[prefix] === 'string' ? vendors[prefix].slice(0, 100) : null;
        if (!device.hostname) {
          try { device.hostname = (await withTimeout(reverse(device.ip), 1200))[0]?.slice(0, 100) || null; } catch { device.hostname = null; }
        }
      }));
      const cutoff = now() - 30 * 60 * 1000;
      const devices = [...found.values()].filter(d => Date.parse(d.lastSeen) >= cutoff)
        .map(d => ({ ...d, status: d.lastSeen === timestamp ? 'online' : d.status === 'offline' ? 'offline' : 'recent' }))
        .sort((a, b) => (ipv4Number(a.ip) || 0) - (ipv4Number(b.ip) || 0)).slice(0, 128);
      const primary = traffic.find(item => item.interface === lan?.interface) || null;
      const history = [...(sameLan ? previous.history || [] : []), { timestamp,
        gatewayLatencyMs: gatewayPing.latencyMs, gatewayLossPercent: gatewayPing.lossPercent,
        internetLatencyMs: internetPing.latencyMs, internetLossPercent: internetPing.lossPercent,
        dnsLatencyMs: dnsResult.latencyMs, rxBytesPerSec: primary?.rxBytesPerSec ?? null,
        txBytesPerSec: primary?.txBytesPerSec ?? null }].slice(-HISTORY);
      snapshot = { timestamp, intervalMs: INTERVAL,
        lan: lan ? { ...lan, gateway, scanSupported: lan.prefix === 24 } : null,
        connectivity: { gateway: gatewayPing, internet: internetPing, dns: dnsResult, web: webResult },
        ports, traffic, devices, cursor: (cursor + scanHosts.length) % 254, history,
        scan: { checkedThisRound: scanHosts.length, totalHosts: lan?.prefix === 24 ? 254 : 0,
          note: lan?.prefix !== 24 ? 'Descoberta ativa disponível apenas em Wi-Fi privado /24.' : null },
        trafficNote: 'Contadores totais por interface do Android (LAN e Internet); Minecraft e túneis não podem ser separados sem instrumentação adicional.' };
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'network.json.tmp'), JSON.stringify(snapshot), { mode: 0o600 });
      await fs.rename(path.join(dir, 'network.json.tmp'), path.join(dir, 'network.json'));
      return snapshot;
    } finally { busy = false; }
  }
  return { tick };
}
async function readNetwork(dir = STATE_DIR) {
  const data = JSON.parse(await fs.readFile(path.join(dir, 'network.json'), 'utf8'));
  return { ...data, stale: !Number.isFinite(Date.parse(data.timestamp)) || Date.now() - Date.parse(data.timestamp) > INTERVAL * 3 };
}
module.exports = { createNetworkMonitor, readNetwork, selectLan, parseGateway, parsePing, parseTraffic,
  hostsForRound, neighbors, privateLan, tcpPort, readVendors, INTERVAL };
