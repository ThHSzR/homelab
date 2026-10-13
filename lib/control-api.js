const express = require('express');
const { createController, failure } = require('./service-control');
const { readHealth } = require('./watchdog');
const { createMinecraftController } = require('./minecraft-control');
const { createTailscaleController } = require('./tailscale-control');
function createAccessGuard(env = process.env, suppliedKeys) {
  let keys;
  return async (req, res, next) => {
    try {
      const issuer = env.CF_ACCESS_ISSUER;
      const admins = (env.CONTROL_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer || '') || !env.CF_ACCESS_AUD || !admins.length)
        throw failure('Controle não configurado pelo administrador.', 503);
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      keys ||= suppliedKeys || createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 4000 });
      const token = req.get('Cf-Access-Jwt-Assertion') || '';
      if (token.length > 16384) throw failure('Token Access acima do limite.', 401);
      const { payload } = await jwtVerify(token, keys,
        { issuer, audience: env.CF_ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
      if (!admins.includes(String(payload.email).toLowerCase()) || payload.type !== 'app') throw failure('Identidade sem autorização.', 403);
      req.controlIdentity = String(payload.sub).slice(0, 200);
      next();
    } catch (error) { res.status(error.status || 401).json({ error: error.status ? error.message : 'Autenticação Access inválida ou indisponível.' }); }
  };
}
function createControlRouter({ controller = createController(), minecraft = createMinecraftController(),
  tailscale = createTailscaleController(), guard = createAccessGuard(), origin = process.env.CONTROL_ORIGIN,
  now = Date.now, requestLimit = 120, actionLimit = 20,
  audit = event => console.log('[control]', JSON.stringify(event)) } = {}) {
  const router = express.Router();
  let windowStart = now(), requests = 0, actions = 0, operating = false;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // One bounded bucket, not an unbounded map keyed by spoofable headers.
  router.use((req, res, next) => {
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; actions = 0; }
    if (++requests > requestLimit) return res.set('Retry-After', '60').status(429).json({ error: 'Limite de consultas atingido.' });
    next();
  });
  router.use(guard);
  router.get('/', async (req, res) => {
    let minecraftState = 'unknown';
    try {
      const health = await readHealth();
      if (!health.stale && ['online', 'offline'].includes(health.services?.minecraft?.status))
        minecraftState = health.services.minecraft.status;
    } catch { /* Missing or stale monitor never confirms an offline server. */ }
    const [bom, current, userspace] = await Promise.all([controller.status(), minecraft.status(), tailscale.status()]);
    res.json({ 'bom-dia': bom, minecraft: { ...current,
      state: current.available ? current.state : minecraftState }, 'tailscale-userspace': userspace });
  });
  router.post('/:id', (req, res, next) => {
    let validOrigin = false;
    try { const url = new URL(origin); validOrigin = url.protocol === 'https:' && url.origin === origin; } catch {}
    if (!validOrigin || req.get('Origin') !== origin ||
      (req.get('Sec-Fetch-Site') && req.get('Sec-Fetch-Site') !== 'same-origin') ||
      req.get('X-Homelab-Control') !== '1' || !req.is('application/json'))
      return res.status(403).json({ error: 'Origem ou formato da solicitação rejeitado.' });
    next();
  }, express.json({ limit: '1kb' }), async (req, res) => {
    if (!['bom-dia', 'minecraft', 'tailscale-userspace'].includes(req.params.id) || !req.body || Object.keys(req.body).length !== 1 ||
      !['start', 'stop'].includes(req.body.action)) return res.status(400).json({ error: 'Serviço ou ação inválidos.' });
    if (++actions > actionLimit) return res.set('Retry-After', '60').status(429).json({ error: 'Limite de operações atingido.' });
    if (operating) return res.status(409).json({ error: 'Outra operação administrativa está em andamento.' });
    operating = true;
    const event = { service: req.params.id, action: req.body.action, subject: req.controlIdentity || 'test' };
    audit({ ...event, result: 'requested' });
    let background = false;
    try {
      if (req.params.id === 'minecraft') {
        const result = await minecraft.request(req.body.action);
        if (minecraft.settled) {
          background = true;
          Promise.resolve(minecraft.settled()).then(async () => {
            const state = await minecraft.status();
            audit({ ...event, result: state.reason ? 'failed' : 'completed', state: state.state });
          }).catch(() => audit({ ...event, result: 'failed' })).finally(() => { operating = false; });
        }
        audit({ ...event, result: 'accepted' });
        return res.status(202).json(result);
      }
      const result = await (req.params.id === 'bom-dia' ? controller : tailscale).set(req.body.action);
      audit({ ...event, result: 'completed', state: result.state });
      res.json(result);
    }
    catch (error) { audit({ ...event, result: 'failed', status: error.status || 503 }); res.status(error.status || 503).json({ error: error.status ? error.message : 'Falha ao persistir ou controlar o serviço.' }); }
    finally { if (!background) operating = false; }
  });
  router.use((error, req, res, next) => res.status(400).json({ error: 'Solicitação inválida.' }));
  return router;
}
module.exports = { createControlRouter, createAccessGuard };
