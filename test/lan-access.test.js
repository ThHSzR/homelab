const test = require('node:test');
const assert = require('node:assert/strict');
const { lanAccess } = require('../lib/lan-access');
function request({ peer = '192.168.1.20', local = '192.168.1.18', port = 3000, method = 'GET', headers = {} } = {}) {
  let result = 200;
  const req = { method, socket: { remoteAddress: peer, localAddress: local, localPort: port }, get: key => headers[key] };
  const res = { status(code) { result = code; return this; }, json() {} };
  lanAccess(req, res, () => { result = 204; });
  return result;
}
test('dashboard accepts private IPv4 LAN and loopback, without trusting forged forwarding headers', () => {
  for (const peer of ['192.168.1.20', '10.0.0.2', '172.16.0.2', '::ffff:192.168.1.20', '127.0.0.1', '::1'])
    assert.equal(request({ peer }), 204);
  for (const peer of ['8.8.8.8', '100.65.49.34', '172.32.0.1', '2804:1234::1', '', '192.168.evil'])
    assert.equal(request({ peer, headers: { 'X-Forwarded-For': '192.168.1.20', 'CF-Connecting-IP': '127.0.0.1' } }), 403);
});
test('LAN commands require browser origin and host matching the actual local socket address', () => {
  const headers = { Origin: 'http://192.168.1.18:3000', Host: '192.168.1.18:3000' };
  assert.equal(request({ method: 'POST', headers }), 204);
  assert.equal(request({ method: 'POST', headers: { ...headers, 'Sec-Fetch-Site': 'same-origin' } }), 204);
  for (const overrides of [{ Origin: 'https://evil.example' }, { Host: 'evil.example' }, { Origin: undefined },
    { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://192.168.1.25:3000' }])
    assert.equal(request({ method: 'POST', headers: { ...headers, ...overrides } }), 403);
  assert.equal(request({ method: 'POST', local: '1.2.3.4', headers }), 403);
});
test('Cloudflare tunnel and local probes preserve their loopback behavior', () => {
  assert.equal(request({ peer: '127.0.0.1', method: 'POST' }), 204);
  assert.equal(request({ peer: '::ffff:127.0.0.1', method: 'POST', headers: { Origin: 'https://homelab.thsouza.eng.br' } }), 204);
});
test('server and PM2 use a persistent LAN listener by default while respecting an explicit HOST override', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /app\.use\(require\('\.\/lib\/lan-access'\)\.lanAccess\)/);
  assert.match(source, /process\.env\.HOST \|\| '0\.0\.0\.0'/);
  const file = require.resolve('../ecosystem.config.cjs');
  const previous = process.env.HOST;
  try {
    delete process.env.HOST; delete require.cache[file];
    assert.equal(require(file).apps[0].env.HOST, '0.0.0.0');
    process.env.HOST = '127.0.0.1'; delete require.cache[file];
    assert.equal(require(file).apps[0].env.HOST, '127.0.0.1');
  } finally { if (previous == null) delete process.env.HOST; else process.env.HOST = previous; delete require.cache[file]; }
});
