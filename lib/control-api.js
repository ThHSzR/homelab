const express = require('express');
const { createController, failure } = require('./service-control');
const { readHealth } = require('./watchdog');
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
      const { payload } = await jwtVerify(req.get('Cf-Access-Jwt-Assertion') || '', keys,
        { issuer, audience: env.CF_ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'] });
      if (!admins.includes(String(payload.email).toLowerCase()) || payload.type !== 'app') throw failure('Identidade sem autorização.', 403);
      next();
    } catch (error) { res.status(error.status || 401).json({ error: error.status ? error.message : 'Autenticação Access inválida ou indisponível.' }); }
  };
}
function createControlRouter({ controller = createController(), guard = createAccessGuard(), origin = process.env.CONTROL_ORIGIN } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(guard);
  router.get('/', async (req, res) => {
    let minecraftState = 'unknown';
    try {
      const health = await readHealth();
      if (!health.stale && ['online', 'offline'].includes(health.services?.minecraft?.status))
        minecraftState = health.services.minecraft.status;
    } catch { /* Missing or stale monitor never confirms an offline server. */ }
    res.json({ 'bom-dia': await controller.status(), minecraft: { state: minecraftState, available: false,
      reason: 'Gerenciador e comandos do Minecraft ainda não confirmados.' } });
  });
  router.post('/:id', (req, res, next) => {
    if (!origin || !/^https:\/\//.test(origin) || req.get('Origin') !== origin ||
      (req.get('Sec-Fetch-Site') && req.get('Sec-Fetch-Site') !== 'same-origin') ||
      req.get('X-Homelab-Control') !== '1' || !req.is('application/json'))
      return res.status(403).json({ error: 'Origem ou formato da solicitação rejeitado.' });
    next();
  }, express.json({ limit: '1kb' }), async (req, res) => {
    if (!['bom-dia', 'minecraft'].includes(req.params.id) || !req.body || Object.keys(req.body).length !== 1 ||
      !['start', 'stop'].includes(req.body.action)) return res.status(400).json({ error: 'Serviço ou ação inválidos.' });
    if (req.params.id === 'minecraft') return res.status(409).json({ error: 'Gerenciamento do Minecraft não configurado.' });
    try { res.json(await controller.set(req.body.action)); }
    catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Falha ao persistir ou controlar o serviço.' }); }
  });
  router.use((error, req, res, next) => res.status(400).json({ error: 'Solicitação inválida.' }));
  return router;
}
module.exports = { createControlRouter, createAccessGuard };
