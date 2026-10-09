const express = require('express');
const path = require('node:path');
const { collect } = require('./lib/collectors');
const modules = require('./modules.json');
const { readHealth } = require('./lib/watchdog');
const { createController } = require('./lib/service-control');
const { createControlRouter } = require('./lib/control-api');
const controller = createController();
const app = express();
app.disable('x-powered-by');
let snapshot = null;
let collecting = false;
async function refresh() {
  if (collecting) return;
  collecting = true;
  try { snapshot = await collect(); }
  catch (error) { console.error('Falha na coleta:', error.message); }
  finally { collecting = false; }
}
let requestSequence = 0;
app.use((req, res, next) => {
  const requestId = String(++requestSequence);
  const startedAt = Date.now();
  res.set('X-Homelab-Origin', 'express');
  res.set('X-Homelab-Request-Id', requestId);
  res.set('X-Homelab-Server-Time', new Date().toISOString());
  if (req.path.startsWith('/api/')) {
    res.on('finish', () => {
      const cfRay = req.get('cf-ray') || '-';
      console.log('[http]', requestId, req.method, req.path, res.statusCode, (Date.now() - startedAt) + 'ms', 'cf-ray=' + cfRay);
    });
  }
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.get('/healthz', (req, res) => res.json({ status: 'ok', uptimeSeconds: process.uptime() }));
app.get('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!snapshot) return res.status(503).json({ error: 'Coleta inicial em andamento' });
  res.json({ ...snapshot, stale: Date.now() - Date.parse(snapshot.timestamp) > 35000 });
});
app.get('/api/modules', (req, res) => res.json(modules));
app.get('/api/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await readHealth()); }
  catch { res.status(503).json({ error: 'Watchdog aguardando primeira leitura ou estado indisponível' }); }
});
app.use('/api/services', createControlRouter({ controller }));
app.use(express.static(path.join(__dirname, 'public')));
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
  console.log('TH HomeLab disponível na porta', server.address().port);
  refresh();
});
const timer = setInterval(refresh, 15000);
let reconciling = false;
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try { await controller.reconcile(); } catch { /* Missing supervisor or held lock: fail closed. */ }
  finally { reconciling = false; }
}
reconcile();
const controlTimer = setInterval(reconcile, 15000);
function shutdown() { clearInterval(timer); clearInterval(controlTimer); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
