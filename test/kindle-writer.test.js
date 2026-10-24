'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createKindleMonitor, createKindleRouter, progress } = require('../lib/kindle-writer');

const id = '20261023-af712fe0', stamp = 'chapter-01-scene-1-1234abcd';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-monitor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, value) => {
    const destination = path.join(root, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, typeof value === 'string' ? value : JSON.stringify(value));
  };
  await write('status.json', { updated: new Date().toISOString(), paused: false, schedule: { enabled: false },
    books: [{ id, status: 'escrevendo', chapter_count: 8, current_step: 'chapter-01-scene-1', attempts: 1,
      error: 'token=private-value', completed_steps: ['concept', 'bible', 'bible-detail', 'bible-canon', 'quality-rejected-plan-01', 'plan-01'] }] });
  await write('config.json', { model: 'models/model.gguf', context: 4096, threads: 2, max_rss_mib: 1072,
    reserve_mib: 384, smtp: { enabled: false, automatic: false, password: 'NEVER_EXPOSE', recipient: 'PRIVATE_ADDRESS' } });
  await write(`data/${id}/concept.json`, { titulo: '<script>untrusted</script>' });
  await write('logs/writer.log', 'evento normal\npassword=TOP_SECRET\n');
  await write(`data/${id}/inference/${stamp}.metrics.json`, { step: 'plan-08', seconds: 100, peak_rss_mib: 980,
    performance: ['prompt eval time = 20 ms (5.20 tokens per second)', 'eval time = 80 ms (3.61 tokens per second)'],
    last_health: { battery: { temperature: 32 }, secret: 'NEVER_EXPOSE' }, private: 'NEVER_EXPOSE' });
  await write(`data/${id}/inference/${stamp}.out.txt`, 'Texto parcial gerado no aparelho.');
  await write(`data/${id}/inference/${stamp}.prompt.txt`, 'PRIVATE_PROMPT');
  await write(`books/${id}-amostra.epub`, 'test-epub');
  await write(`books/${id}-capa.jpg`, 'test-jpeg');
  const processes = () => ({ at: new Date().toISOString(), entries: [{ name: 'kindle-writer', state: 'online', memoryBytes: 30000000, restarts: 2 }] });
  return { root, write, processes };
}

test('monitor returns bounded progress, model telemetry and no private configuration', async t => {
  const data = await fixture(t), monitor = createKindleMonitor(data);
  const result = await monitor.status();
  assert.equal(result.book.id, id);
  assert.equal(result.book.progress.completed, 5);
  assert.equal(result.book.progress.total, 53);
  assert.equal(result.worker.state, 'online');
  assert.equal(result.profile.model, 'model.gguf');
  assert.equal(result.lastInference.generationTps, 3.61);
  assert.equal(result.lastInference.batteryC, 32);
  assert.equal(result.artifacts[0].partial, true);
  assert.equal(result.cover.name, id + '-capa.jpg');
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE|PRIVATE_ADDRESS|private-value|PRIVATE_PROMPT/);
  assert.match(result.book.error, /redigido/);
  assert.equal(result.inference, null);
});

test('PID reuse never labels an unrelated process as the active inference', async t => {
  const data = await fixture(t), procRoot = path.join(data.root, 'fake-proc');
  await data.write('data/inference.pid', '4242');
  await data.write('fake-proc/4242/cmdline', 'node\0server.js\0');
  const monitor = createKindleMonitor({ ...data, procRoot });
  assert.equal((await monitor.status()).inference, null);
  await data.write('fake-proc/4242/cmdline', ['llama-completion', '-f', path.join(data.root, 'data', id, 'inference', stamp + '.prompt.txt'), '-c', '3072', '-t', '2', ''].join('\0'));
  await data.write('fake-proc/4242/status', 'VmRSS: 1000000 kB\nVmHWM: 1024000 kB\n');
  const active = (await monitor.status()).inference;
  assert.equal(active.pid, 4242);
  assert.equal(active.context, 3072);
  assert.equal(active.peakRssMib, 1000);
  assert.equal(active.stamp, stamp);
});

test('unavailable application and stale worker readings are distinguished', async t => {
  const data = await fixture(t);
  const stale = createKindleMonitor({ ...data, processes: () => ({ at: '2000-01-01', entries: [{ name: 'kindle-writer', state: 'online' }] }) });
  assert.equal((await stale.status()).worker.state, 'unknown');
  assert.equal((await stale.status()).worker.stale, true);
  await fs.unlink(path.join(data.root, 'status.json'));
  const missing = await createKindleMonitor(data).status();
  assert.equal(missing.installed, false);
  assert.deepEqual(missing.books, []);
});

test('logs are bounded, redacted and restricted to the two fixed channels', async t => {
  const data = await fixture(t), monitor = createKindleMonitor(data);
  const events = await monitor.logs(id, 'events');
  assert.match(events.text, /evento normal/);
  assert.doesNotMatch(events.text, /TOP_SECRET/);
  assert.equal((await monitor.logs(id, 'generation')).text, 'Texto parcial gerado no aparelho.');
  await assert.rejects(monitor.logs(id, '../../config.json'), { status: 400 });
  await assert.rejects(monitor.status('../private'), { status: 400 });
  await assert.rejects(monitor.status('20261023-aaaaaaaa'), { status: 404 });
  await data.write('logs/writer.log', 'linha\n'.repeat(10000));
  const bounded = await monitor.logs(id);
  assert.ok(bounded.text.length <= 16384);
  assert.ok(bounded.text.split('\n').length <= 120);
});

test('read-only API serves EPUBs and refuses configuration, symlinks and malformed state', async t => {
  const data = await fixture(t), app = express();
  app.use('/api/kindle-writer', createKindleRouter(data));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/kindle-writer`;
  assert.equal((await fetch(base + '/status')).status, 200);
  const epub = await fetch(base + '/books/' + id + '-amostra.epub');
  assert.match(epub.headers.get('content-disposition'), /attachment/);
  assert.match(epub.headers.get('content-type'), /application\/epub\+zip/);
  assert.equal(await epub.text(), 'test-epub');
  const cover = await fetch(base + '/covers/' + id + '-capa.jpg');
  assert.equal(cover.status, 200);
  assert.match(cover.headers.get('content-type'), /image\/jpeg/);
  assert.equal(await cover.text(), 'test-jpeg');
  assert.equal((await fetch(base + '/covers/config.json')).status, 400);
  assert.equal((await fetch(base + '/books/config.json')).status, 400);
  assert.equal((await fetch(base + '/status?book=../../config')).status, 400);
  assert.equal((await fetch(base + '/status', { method: 'POST' })).status, 404);
  const link = path.join(data.root, 'books/20261023-aaaaaaaa.epub');
  try { await fs.symlink(path.join(data.root, 'config.json'), link); }
  catch (error) { if (error.code !== 'EPERM') throw error; }
  if (await fs.lstat(link).catch(() => null)) assert.equal((await fetch(base + '/books/20261023-aaaaaaaa.epub')).status, 403);
  await data.write('status.json', '{broken-json');
  const broken = express();
  broken.use('/kw', createKindleRouter(data));
  const other = broken.listen(0, '127.0.0.1');
  await new Promise(resolve => other.once('listening', resolve));
  t.after(() => new Promise(resolve => other.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${other.address().port}/kw/status`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), new RegExp(data.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a complete eight-chapter book reaches 100% without counting rejected attempts', () => {
  const steps = ['concept', 'bible', 'bible-detail', 'bible-canon', 'final', 'quality-rejected-plan-01'];
  for (let i = 1; i <= 8; i++) {
    const n = String(i).padStart(2, '0');
    steps.push('plan-' + n, 'chapter-' + n + '-scene-1', 'chapter-' + n + '-scene-2', 'review-' + n, 'summary-' + n, 'chapter-' + n);
  }
  assert.equal(progress(steps, 8).percent, 100);
  assert.equal(progress(steps, 8).written, 8);
});

test('Humanizer editions count the additional scene edits without changing legacy totals', () => {
  const steps = ['concept', 'bible', 'bible-detail', 'bible-canon', 'final'];
  for (let i = 1; i <= 8; i++) {
    const n = String(i).padStart(2, '0');
    steps.push('plan-' + n, 'chapter-' + n + '-scene-1', 'chapter-' + n + '-scene-2',
      'review-' + n, 'summary-' + n, 'chapter-' + n);
  }
  assert.equal(progress(steps, 8, 2).total, 69);
  assert.ok(progress(steps, 8, 2).percent < 100);
  for (let i = 1; i <= 8; i++) for (const scene of [1, 2]) steps.push(`humanize-${String(i).padStart(2, '0')}-${scene}`);
  assert.equal(progress(steps, 8, 2).percent, 100);
  assert.equal(progress(steps, 8).total, 53);
  assert.equal(progress(steps, 8).percent, 100);
});
