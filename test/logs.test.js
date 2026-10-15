const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { approvedLogPath, readServiceLogs, readCombinedLogs, redact } = require('../lib/logs');

test('central logs use PM2 allowlist, reject paths outside log roots and redact common secrets', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'logs-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = path.join(home, '.pm2/logs'); await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'playit-out.log');
  await fs.writeFile(file, 'ready\nAuthorization: Bearer abc123\npassword=mysecret\n');
  const entry = { name: 'playit', pm2_env: { pm_out_log_path: file } };
  const run = async () => ({ ok: true, text: JSON.stringify([entry]) });
  const result = await readServiceLogs('playit', 'out', { home, run });
  assert.match(result.text, /ready/);
  assert.doesNotMatch(result.text, /abc123|mysecret/);
  assert.equal(approvedLogPath(path.join(home, 'secret.txt'), 'playit', 'out', home), false);
  await assert.rejects(readServiceLogs('../secret', 'out', { home, run }), { status: 400 });
  await assert.rejects(readServiceLogs('playit', 'other', { home, run }), { status: 400 });
  const unsafe = async () => ({ ok: true, text: JSON.stringify([{ ...entry, pm2_env: { pm_out_log_path: path.join(home, 'secret.txt') } }]) });
  await assert.rejects(readServiceLogs('playit', 'out', { home, run: unsafe }), { status: 403 });
  assert.equal(redact('token = abc\nBearer xyz'), 'token=[redigido]\nBearer [redigido]');
  const combined = await readCombinedLogs('out', { home, run });
  assert.match(combined.text, /── playit ──/);
  assert.doesNotMatch(combined.text, /abc123|mysecret/);
  await assert.rejects(readCombinedLogs('both', { home, run }), { status: 400 });
});
