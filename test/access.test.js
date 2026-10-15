const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAccessGuard, accessConfig, localConnection } = require('../lib/access');

test('administrative access requires a signed, current token for the configured application', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' };
  const issuer = 'https://example.cloudflareaccess.com';
  const now = 1_800_000_000_000;
  let fetched = 0;
  const guard = createAccessGuard({ config: { issuer, audience: 'app-audience' }, now: () => now,
    fetcher: async () => { fetched++; return { ok: true, json: async () => ({ keys: [key] }) }; } });
  function token(payload = {}, algorithm = 'RS256', signer = privateKey) {
    const header = Buffer.from(JSON.stringify({ alg: algorithm, kid: 'test-key' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: issuer, aud: ['app-audience'], iat: now / 1000,
      exp: now / 1000 + 3600, ...payload })).toString('base64url');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + body), signer).toString('base64url');
    return header + '.' + body + '.' + signature;
  }
  assert.equal(await guard.verify(token()), true);
  assert.equal(await guard.verify(token({ aud: 'app-audience' })), true);
  assert.equal(await guard.verify(token({ aud: ['another-app'] })), false);
  assert.equal(await guard.verify(token({ exp: now / 1000 - 1 })), false);
  assert.equal(await guard.verify(token({}, 'none')), false);
  assert.equal(await guard.verify(token({}, 'RS256', crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey)), false);
  assert.equal(await guard.verify('bad-token'), false);
  assert.equal(fetched, 1);
});

test('missing Access configuration and non-loopback sockets fail closed', async () => {
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: 'example.com', ACCESS_AUD: 'valid-audience-value' }), null);
  assert.equal(await createAccessGuard({ config: null }).verify('anything'), false);
  assert.equal(localConnection({ socket: { localAddress: '127.0.0.1', remoteAddress: '100.65.49.34' } }), false);
});
