const crypto = require('node:crypto');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_TOKEN_LENGTH = 8192;
const KEY_TTL_MS = 60 * 60 * 1000;

function localConnection(req) {
  return LOOPBACK.has(req.socket.localAddress) && LOOPBACK.has(req.socket.remoteAddress);
}

function accessConfig(env = process.env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!team || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(team) ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(audience)) return null;
  return { issuer: 'https://' + team.toLowerCase(), audience };
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('JWT inválido');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function createAccessGuard({ config = accessConfig(), fetcher = fetch, now = Date.now } = {}) {
  let cachedKeys = null;
  let keyExpiresAt = 0;
  let loading = null;
  let lastRotationCheck = 0;
  async function keys() {
    if (cachedKeys && now() < keyExpiresAt) return cachedKeys;
    if (!loading) loading = (async () => {
      const response = await fetcher(config.issuer + '/cdn-cgi/access/certs', {
        signal: AbortSignal.timeout(4000), redirect: 'error'
      });
      if (!response.ok) throw new Error('Chaves Access indisponíveis');
      const data = await response.json();
      if (!Array.isArray(data.keys) || data.keys.length < 1 || data.keys.length > 5) throw new Error('Chaves Access inválidas');
      const next = new Map();
      for (const jwk of data.keys) {
        if (jwk.kty !== 'RSA' || !jwk.kid || jwk.alg && jwk.alg !== 'RS256') continue;
        next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
      }
      if (!next.size) throw new Error('Nenhuma chave Access válida');
      cachedKeys = next;
      keyExpiresAt = now() + KEY_TTL_MS;
      return next;
    })().finally(() => { loading = null; });
    return loading;
  }
  async function verify(token) {
    if (!config || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    let header, payload;
    try { header = decodePart(parts[0]); payload = decodePart(parts[1]); } catch { return false; }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return false;
    const seconds = now() / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== config.issuer || !audiences.includes(config.audience) ||
      !Number.isFinite(payload.exp) || payload.exp <= seconds ||
      !Number.isFinite(payload.iat) || payload.iat > seconds + 60 ||
      payload.nbf != null && (!Number.isFinite(payload.nbf) || payload.nbf > seconds + 60)) return false;
    try {
      let key = (await keys()).get(header.kid);
      if (!key && now() - lastRotationCheck >= 60000) {
        lastRotationCheck = now();
        keyExpiresAt = 0;
        key = (await keys()).get(header.kid);
      }
      return !!key && crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key,
        Buffer.from(parts[2], 'base64url'));
    } catch { return false; }
  }
  async function middleware(req, res, next) {
    res.set('Cache-Control', 'no-store');
    let host = null;
    try {
      const url = new URL(process.env.CONTROL_ORIGIN || 'https://homelab.thsouza.eng.br');
      if (url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash) host = url.host;
    } catch {}
    if (!localConnection(req) || !config || !host || req.get('Host') !== host ||
      !(await verify(req.get('Cf-Access-Jwt-Assertion'))))
      return res.status(403).json({ error: 'Acesso administrativo exige Cloudflare Access autenticado.' });
    next();
  }
  return { verify, middleware };
}

module.exports = { accessConfig, createAccessGuard, localConnection };
