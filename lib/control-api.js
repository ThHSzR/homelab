const express = require('express');
const { createController } = require('./service-control');
const { readHealth } = require('./watchdog');
const { createMinecraftController } = require('./minecraft-control');
const { createTailscaleController } = require('./tailscale-control');

// Cloudflare Access is the sole authentication layer. The Express listener
// binds to 127.0.0.1 by default and is reached through the protected tunnel.
// Only fixed service identifiers and fixed start/stop actions are accepted.
function createControlRouter({
  controller = createController(),
  minecraft = createMinecraftController(),
  tailscale = createTailscaleController(),
  audit = event => console.log('[control]', JSON.stringify(event))
} = {}) {
  const router = express.Router();
  let operating = false;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/', async (req, res) => {
    let minecraftState = 'unknown';
    try {
      const health = await readHealth();
      if (!health.stale && ['online', 'offline'].includes(health.services?.minecraft?.status))
        minecraftState = health.services.minecraft.status;
    } catch {}
    try {
      const [bom, current, userspace] = await Promise.all([
        controller.status(), minecraft.status(), tailscale.status()
      ]);
      res.json({ 'bom-dia': bom, minecraft: { ...current,
        state: current.available ? current.state : minecraftState }, 'tailscale-userspace': userspace });
    } catch {
      res.status(503).json({ error: 'Não foi possível consultar os serviços.' });
    }
  });
  router.post('/:id', express.json({ limit: '1kb' }), async (req, res) => {
    const id = req.params.id;
    const action = req.body?.action;
    if (!['bom-dia', 'minecraft', 'tailscale-userspace'].includes(id) ||
        !req.is('application/json') ||
        !req.body || Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 || !['start', 'stop'].includes(action))
      return res.status(400).json({ error: 'Serviço ou ação inválidos.' });
    if (operating) return res.status(409).json({ error: 'Outra operação administrativa está em andamento.' });
    operating = true;
    const event = { service: id, action };
    audit({ ...event, result: 'requested' });
    let background = false;
    try {
      if (id === 'minecraft') {
        const result = await minecraft.request(action);
        if (minecraft.settled) {
          background = true;
          Promise.resolve(minecraft.settled()).then(async () => {
            const state = await minecraft.status();
            audit({ ...event, result: state.reason ? 'failed' : 'completed', state: state.state });
          }).catch(() => audit({ ...event, result: 'failed' }))
            .finally(() => { operating = false; });
        }
        audit({ ...event, result: 'accepted' });
        return res.status(202).json(result);
      }
      const result = await (id === 'bom-dia' ? controller : tailscale).set(action);
      audit({ ...event, result: 'completed', state: result.state });
      res.json(result);
    } catch (error) {
      audit({ ...event, result: 'failed', status: error.status || 503 });
      res.status(error.status || 503).json({
        error: error.status ? error.message : 'Falha ao controlar o serviço.'
      });
    } finally {
      if (!background) operating = false;
    }
  });
  router.use((error, req, res, next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'Solicitação inválida.' }));
  return router;
}
module.exports = { createControlRouter };
