'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { redact } = require('./logs');

const BOOK = /^\d{8}-[a-f0-9]{8}$/;
const EPUB = /^\d{8}-[a-f0-9]{8}(?:-amostra)?\.epub$/;
const STAMP = /^(?:concept|bible|bible-detail|plan-\d{2}|chapter-\d{2}-scene-[12]|review-\d{2}|summary-\d{2}|final)-[a-f0-9]{8}$/;
const text = (value, max = 500) => typeof value === 'string' ? redact(value).slice(0, max) : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const absent = error => error.code === 'ENOENT' || error.code === 'ENOTDIR';

// Fixed relative paths only; no prompts, database, credentials or arbitrary file reads.
async function openInside(root, relative, maxBytes) {
  const base = await fs.realpath(root);
  const expected = path.resolve(base, relative);
  if (!expected.startsWith(base + path.sep)) throw new Error('Caminho recusado');
  const real = await fs.realpath(expected);
  if (real !== expected) throw new Error('Link simbólico recusado');
  const handle = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Arquivo inválido ou grande demais');
    return { handle, stat };
  } catch (error) { await handle.close(); throw error; }
}

async function readJson(root, relative, max = 2 * 1024 * 1024) {
  const { handle } = await openInside(root, relative, max);
  try { return JSON.parse(await handle.readFile({ encoding: 'utf8' })); }
  finally { await handle.close(); }
}

async function tail(root, relative, bytes = 16384) {
  const { handle, stat } = await openInside(root, relative, 32 * 1024 * 1024);
  try {
    const size = Math.min(bytes, stat.size), buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, stat.size - size);
    let value = buffer.subarray(0, bytesRead).toString('utf8');
    if (stat.size > size) value = value.slice(value.indexOf('\n') + 1);
    return redact(value).split('\n').slice(-120).join('\n');
  } finally { await handle.close(); }
}

function progress(names, chapters) {
  const done = new Set(names);
  let plans = 0, scenes = 0, reviewed = 0, written = 0, count = 0;
  for (const key of ['concept', 'bible', 'bible-detail', 'bible-canon', 'final']) if (done.has(key)) count++;
  for (let i = 1; i <= chapters; i++) {
    const n = String(i).padStart(2, '0');
    if (done.has('plan-' + n)) { plans++; count++; }
    for (const scene of [1, 2]) if (done.has(`chapter-${n}-scene-${scene}`)) { scenes++; count++; }
    if (done.has('review-' + n)) count++;
    if (done.has('summary-' + n)) count++;
    if (done.has('chapter-' + n)) { written++; reviewed++; count++; }
  }
  const total = chapters * 6 + 5;
  return { completed: count, total, percent: Math.floor(count / total * 100), plans, scenes, reviewed, written };
}

function createKindleMonitor({ root = process.env.KINDLE_WRITER_DIR || path.join(os.homedir(), 'services/kindle-writer'),
  processes = () => null, procRoot = '/proc', now = Date.now } = {}) {
  let cached = null, cachedAt = 0, inFlight = null;
  async function state() {
    if (cached && now() - cachedAt < 5000) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let source;
      try { source = await readJson(root, 'status.json'); }
      catch (error) {
        if (absent(error)) return { installed: false, books: [], paused: false, schedule: { enabled: false } };
        throw error;
      }
      if (!Array.isArray(source.books) || typeof source.paused !== 'boolean') throw new Error('Estado inválido');
      const books = source.books.filter(b => BOOK.test(b.id) && Number.isInteger(b.chapter_count) && b.chapter_count >= 2 && b.chapter_count <= 60)
        .slice(0, 40).map(b => ({ id: b.id, status: text(b.status, 30), chapters: b.chapter_count,
          step: text(b.current_step, 80), attempts: number(b.attempts), retryAt: number(b.retry_at),
          error: text(b.error, 800), created: text(b.created, 40), updated: text(b.updated, 40),
          progress: progress(Array.isArray(b.completed_steps) ? b.completed_steps : [], b.chapter_count) }));
      let cfg = {};
      try { cfg = await readJson(root, 'config.json', 65536); } catch { /* Optional private config, never returned. */ }
      return { installed: true, sourceUpdated: text(source.updated, 40), paused: source.paused, books,
        schedule: { enabled: source.schedule?.enabled === true, nextRun: number(source.schedule?.next_run) },
        mail: { enabled: cfg.smtp?.enabled === true, automatic: cfg.smtp?.automatic === true },
        profile: { model: typeof cfg.model === 'string' ? path.basename(cfg.model) : null,
          threads: number(cfg.threads), context: number(cfg.context), maxRssMib: number(cfg.max_rss_mib),
          reserveMib: number(cfg.reserve_mib), maxBatteryC: number(cfg.max_battery_c) } };
    })();
    try { cached = await inFlight; cachedAt = now(); return cached; }
    finally { inFlight = null; }
  }

  function worker() {
    const observed = processes();
    const fresh = observed && now() - Date.parse(observed.at) < 45000;
    const p = fresh && observed.entries?.find(item => item.name === 'kindle-writer');
    return { state: p ? text(p.state, 30) : fresh && observed.entries ? 'unmanaged' : 'unknown',
      stale: !fresh, pid: p ? number(p.pid) : null, restarts: p ? number(p.restarts) : null,
      memoryMib: p ? number(p.memoryBytes) == null ? null : p.memoryBytes / 1048576 : null };
  }

  async function active(book) {
    if (!book) return null;
    try {
      const { handle } = await openInside(root, 'data/inference.pid', 20);
      let pid;
      try { pid = (await handle.readFile('utf8')).trim(); } finally { await handle.close(); }
      if (!/^[1-9]\d{0,8}$/.test(pid)) return null;
      const args = (await fs.readFile(path.join(procRoot, pid, 'cmdline'), 'utf8')).split('\0');
      if (!['llama-completion', 'llama-cli'].includes(path.basename(args[0]))) return null;
      const prompt = args[args.indexOf('-f') + 1];
      if (!prompt || args.indexOf('-f') < 0) return null;
      const base = await fs.realpath(root);
      const directory = path.join(base, 'data', book.id, 'inference');
      const name = path.basename(prompt).replace(/\.prompt\.txt$/, '');
      if (path.dirname(prompt) !== directory || !STAMP.test(name)) return null;
      const processStatus = await fs.readFile(path.join(procRoot, pid, 'status'), 'utf8');
      const rss = /^VmRSS:\s+(\d+)/m.exec(processStatus), peak = /^VmHWM:\s+(\d+)/m.exec(processStatus);
      const stat = await fs.stat(prompt);
      const tokenArg = key => { const index = args.indexOf(key); return index >= 0 ? number(Number(args[index + 1])) : null; };
      return { pid: Number(pid), stamp: name, started: stat.mtime.toISOString(),
        elapsedSeconds: Math.max(0, Math.floor((now() - stat.mtimeMs) / 1000)),
        rssMib: rss ? Number(rss[1]) / 1024 : null, peakRssMib: peak ? Number(peak[1]) / 1024 : null,
        context: tokenArg('-c'), threads: tokenArg('-t') };
    } catch { return null; }
  }

  const latestCache = new Map();
  async function latest(book, suffix) {
    if (!book) return null;
    const key = book.id + suffix, cached = latestCache.get(key);
    if (cached && now() - cached.at < 15000) return cached.value;
    const relative = path.join('data', book.id, 'inference');
    try {
      // Resolve the directory before listing; symlinks never widen this reader's scope.
      const base = await fs.realpath(root), folder = path.join(base, relative);
      if (await fs.realpath(folder) !== folder) throw new Error('Diretório recusado');
      const names = (await fs.readdir(folder)).filter(name => name.endsWith(suffix) && STAMP.test(name.slice(0, -suffix.length))).slice(-2000);
      let selected = null;
      for (const name of names) {
        const stat = await fs.lstat(path.join(folder, name));
        if (stat.isFile() && (!selected || stat.mtimeMs > selected.time)) selected = { name, time: stat.mtimeMs };
      }
      const value = selected ? path.join(relative, selected.name) : null;
      if (latestCache.size > 80) latestCache.clear();
      latestCache.set(key, { at: now(), value });
      return value;
    } catch { return null; }
  }

  async function artifacts(book) {
    if (!book) return [];
    try {
      const base = await fs.realpath(root), folder = path.join(base, 'books');
      if (await fs.realpath(folder) !== folder) return [];
      const names = (await fs.readdir(folder)).filter(name => EPUB.test(name) && name.startsWith(book.id)).slice(0, 2);
      const result = [];
      for (const name of names) {
        const stat = await fs.lstat(path.join(folder, name));
        if (stat.isFile()) result.push({ name, bytes: stat.size, updated: stat.mtime.toISOString(),
          partial: name.endsWith('-amostra.epub'), url: '/api/kindle-writer/books/' + name });
      }
      return result;
    } catch { return []; }
  }

  async function select(id) {
    if (id != null && (typeof id !== 'string' || !BOOK.test(id))) throw Object.assign(new Error('Livro inválido'), { status: 400 });
    const data = await state();
    const book = id ? data.books.find(b => b.id === id) : data.books.find(b => !['finalizado', 'enviado', 'falhou'].includes(b.status)) || data.books[0];
    if (id && !book) throw Object.assign(new Error('Livro não encontrado'), { status: 404 });
    return { data, book };
  }

  async function status(id) {
    const { data, book } = await select(id);
    let title = null, metric = null;
    if (book) {
      try { title = text((await readJson(root, path.join('data', book.id, 'concept.json'), 32768)).titulo, 160); } catch {}
      const last = await latest(book, '.metrics.json');
      if (last) {
        try {
          const m = await readJson(root, last, 1024 * 1024);
          const speed = prefix => {
            const line = m.performance?.find(value => typeof value === 'string' && value.trim().startsWith(prefix));
            const match = line && /([\d.]+) tokens per second/.exec(line);
            return match ? number(Number(match[1])) : null;
          };
          metric = { step: text(m.step, 80), at: text(m.at, 40), seconds: number(m.seconds),
            peakRssMib: number(m.peak_rss_mib), context: number(m.context), promptTokens: number(m.prompt_tokens),
            generationTps: speed('eval time'), promptTps: speed('prompt eval time'),
            batteryC: number(m.last_health?.battery?.temperature), exitCode: m.exit_code === 0 ? 0 : null };
        } catch {}
      }
    }
    return { ...data, checkedAt: new Date(now()).toISOString(), worker: worker(),
      book: book ? { ...book, title } : null, inference: await active(book), lastInference: metric,
      artifacts: await artifacts(book) };
  }

  async function logs(id, channel = 'events') {
    if (!['events', 'generation'].includes(channel)) throw Object.assign(new Error('Canal inválido'), { status: 400 });
    const { book } = await select(id);
    let relative = 'logs/writer.log', running = null;
    if (channel === 'generation') {
      running = await active(book);
      relative = running ? path.join('data', book.id, 'inference', running.stamp + '.out.txt') : await latest(book, '.out.txt');
    }
    let value = '';
    if (relative) {
      try { value = await tail(root, relative); }
      catch (error) { if (!absent(error)) throw error; }
    }
    return { channel, book: book?.id || null, text: value, active: !!running,
      step: channel === 'generation' && relative ? path.basename(relative).replace(/-[a-f0-9]{8}\.out\.txt$/, '') : null,
      maxBytes: 16384, maxLines: 120,
      checkedAt: new Date(now()).toISOString() };
  }
  return { status, logs, root };
}

function createKindleRouter(options) {
  const monitor = createKindleMonitor(options), router = express.Router();
  const fail = (res, error) => res.status(error.status || 503).json({ error: error.status ? error.message : 'Monitor do Kindle Writer temporariamente indisponível.' });
  router.get('/status', async (req, res) => {
    try { res.json(await monitor.status(req.query.book)); } catch (error) { fail(res, error); }
  });
  router.get('/logs', async (req, res) => {
    try { res.json(await monitor.logs(req.query.book, req.query.channel || 'events')); } catch (error) { fail(res, error); }
  });
  router.get('/books/:name', async (req, res) => {
    if (!EPUB.test(req.params.name)) return res.status(400).json({ error: 'Arquivo EPUB inválido.' });
    try {
      const { handle } = await openInside(monitor.root, path.join('books', req.params.name), 50 * 1024 * 1024);
      res.type('application/epub+zip').attachment(req.params.name);
      const stream = handle.createReadStream();
      res.on('close', () => stream.destroy());
      stream.on('error', () => { if (!res.headersSent) res.status(503).end(); else res.destroy(); });
      stream.pipe(res);
    } catch (error) { res.status(absent(error) ? 404 : 403).json({ error: 'EPUB indisponível.' }); }
  });
  return router;
}
module.exports = { createKindleMonitor, createKindleRouter, progress };
