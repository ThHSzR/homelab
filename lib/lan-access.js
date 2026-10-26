const net = require('node:net');

function ipv4(address) {
  return String(address || '').replace(/^::ffff:/, '');
}
function loopback(address) {
  const ip = ipv4(address);
  return ip === '::1' || net.isIP(ip) === 4 && ip.startsWith('127.');
}
function privateLan(address) {
  const ip = ipv4(address);
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}

// Trust the TCP peer, never forwarding headers supplied by a LAN client.
// Cloudflared connects over loopback and retains the existing Access policy.
function lanAccess(req, res, next) {
  const peer = req.socket.remoteAddress;
  if (loopback(peer)) return next();
  if (!privateLan(peer)) return res.status(403).json({ error: 'Acesso direto permitido apenas pela rede local.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const address = ipv4(req.socket.localAddress);
    const expectedOrigin = 'http://' + address + (req.socket.localPort === 80 ? '' : ':' + req.socket.localPort);
    if (!privateLan(address) || req.get('Origin') !== expectedOrigin ||
      req.get('Host') !== new URL(expectedOrigin).host ||
      req.get('Sec-Fetch-Site') && req.get('Sec-Fetch-Site') !== 'same-origin')
      return res.status(403).json({ error: 'Abra o dashboard pelo IP local para executar esta operação.' });
  }
  next();
}
module.exports = { lanAccess, loopback, privateLan };
