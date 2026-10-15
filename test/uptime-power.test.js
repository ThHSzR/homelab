const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { advanceUptime } = require('../lib/uptime');
const { createPowerTracker } = require('../lib/power-events');

test('uptime counts observed duration and treats monitor gaps as unknown', () => {
  const before = { minecraft: { status: 'online' } };
  const after = { minecraft: { status: 'offline' } };
  const start = '2026-10-14T23:59:30.000Z';
  const end = '2026-10-15T00:01:30.000Z';
  const result = advanceUptime({}, before, after, start, end);
  assert.equal(result.days['2026-10-14'].minecraft.online, 30000);
  assert.equal(result.days['2026-10-15'].minecraft.online, 60000);
  assert.equal(result.days['2026-10-15'].minecraft.unknown, 30000);
  assert.deepEqual(result.events.map(event => [event.id, event.from, event.to]), [['minecraft', 'online', 'offline']]);
});

test('power tracker persists unplug and reconnect duration across restarts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-power-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let time = Date.parse('2026-10-15T10:00:00Z');
  const first = createPowerTracker({ dir, now: () => time });
  await first.update({ available: true, plugged: 'PLUGGED_AC' });
  time += 1000;
  const disconnected = await first.update({ available: true, plugged: 'UNPLUGGED' });
  assert.equal(disconnected.connection, 'unplugged');
  time += 61000;
  const second = createPowerTracker({ dir, now: () => time });
  const reconnected = await second.update({ available: true, plugged: 'PLUGGED_AC' });
  assert.equal(reconnected.history.at(-1).outageMs, 61000);
  assert.equal(reconnected.connection, 'plugged');
});
