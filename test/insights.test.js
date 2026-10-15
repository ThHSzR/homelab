const test = require('node:test');
const assert = require('node:assert/strict');
const { getInsights } = require('../public/insights');

test('alerts use fresh readings and omit service outages', () => {
  const stamp = new Date().toISOString();
  const status = { timestamp: stamp, stale: false, battery: { available: true, percentage: 12, status: 'DISCHARGING', temperature: 43 },
    disk: { percent: 90 } };
  const health = { timestamp: stamp, stale: false, services: {
    dashboard: { status: 'online' },
    ssh: { status: 'offline', failures: 3 },
    'bom-dia': { status: 'offline', failures: 3 },
    external: { status: 'online', failures: 0 },
    minecraft: { status: 'online', process: { memoryPercent: 38 } }
  } };
  const result = getInsights(status, health);
  assert.deepEqual(result.issues.map(issue => issue.title), [
    'Bateria baixa', 'Bateria quente', 'Armazenamento quase cheio', 'Minecraft usa muita RAM'
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.issues.some(issue => /SSH|Bom Dia/.test(issue.title)), false);
});

test('stale and missing readings never produce a false all-clear', () => {
  const staleStatus = { stale: true, battery: { available: true, percentage: 1, status: 'DISCHARGING' } };
  assert.deepEqual(getInsights(staleStatus, null), { issues: [], complete: false, anyFresh: false });
  const partial = getInsights({ timestamp: new Date().toISOString(), stale: false, battery: { available: false }, disk: null }, null);
  assert.equal(partial.complete, false);
  assert.equal(partial.anyFresh, true);
  assert.equal(partial.issues.length, 0);
});

test('normal conditions produce no alerts', () => {
  const stamp = new Date().toISOString();
  const status = { timestamp: stamp, stale: false, battery: { available: true, percentage: 18, status: 'CHARGING', temperature: 31 },
    disk: { percent: 40 } };
  const health = { timestamp: stamp, stale: false, services: { dashboard: { status: 'online' }, ssh: { status: 'online' },
    'bom-dia': { status: 'online' }, external: { status: 'online' },
    minecraft: { status: 'offline', process: { memoryPercent: 40 } } } };
  assert.deepEqual(getInsights(status, health).issues, []);
});

test('intentional Minecraft stop is quiet; unexpected repeated failure and power loss are visible', () => {
  const timestamp = new Date().toISOString();
  const status = { timestamp, stale: false, battery: { available: true, percentage: 60, status: 'DISCHARGING' },
    disk: { percent: 30 }, power: { available: true, connection: 'unplugged', changedAt: timestamp } };
  const health = { timestamp, stale: false, services: { dashboard: { status: 'online' }, ssh: { status: 'online' },
    external: { status: 'online' }, minecraft: { status: 'offline', expected: 'offline', failures: 10 },
    'bom-dia': { status: 'offline', expected: 'online', failures: 3 } } };
  assert.deepEqual(getInsights(status, health).issues.map(issue => issue.title), ['A30 sem alimentação', 'Bom Dia indisponível']);
  health.services.minecraft.expected = 'online';
  assert.ok(getInsights(status, health).issues.some(issue => issue.title === 'Minecraft indisponível'));
});
