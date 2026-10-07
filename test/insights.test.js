const test = require('node:test');
const assert = require('node:assert/strict');
const { getInsights } = require('../public/insights');

test('alerts use fresh readings and require sustained service failures', () => {
  const status = { stale: false, battery: { available: true, percentage: 12, status: 'DISCHARGING', temperature: 43 },
    disk: { percent: 90 } };
  const health = { stale: false, services: {
    ssh: { status: 'offline', failures: 1 },
    'bom-dia': { status: 'offline', failures: 3 },
    external: { status: 'online', failures: 0 },
    minecraft: { status: 'online', process: { memoryPercent: 38 } }
  } };
  const result = getInsights(status, health);
  assert.deepEqual(result.issues.map(issue => issue.title), [
    'Bateria baixa', 'Bateria quente', 'Armazenamento quase cheio', 'Bom Dia indisponível', 'Minecraft usa muita RAM'
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.issues.some(issue => issue.title.includes('SSH')), false);
});

test('stale and missing readings never produce a false all-clear', () => {
  const staleStatus = { stale: true, battery: { available: true, percentage: 1, status: 'DISCHARGING' } };
  assert.deepEqual(getInsights(staleStatus, null), { issues: [], complete: false, anyFresh: false });
  const partial = getInsights({ stale: false, battery: { available: false }, disk: null }, null);
  assert.equal(partial.complete, false);
  assert.equal(partial.anyFresh, true);
  assert.equal(partial.issues.length, 0);
});

test('normal conditions produce no alerts', () => {
  const status = { stale: false, battery: { available: true, percentage: 18, status: 'CHARGING', temperature: 31 },
    disk: { percent: 40 } };
  const health = { stale: false, services: { ssh: { status: 'online' },
    'bom-dia': { status: 'online' }, external: { status: 'online' },
    minecraft: { status: 'offline', process: { memoryPercent: 40 } } } };
  assert.deepEqual(getInsights(status, health).issues, []);
});
