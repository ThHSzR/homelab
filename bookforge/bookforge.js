'use strict';

// Biblioteca IA: self-hosted, offline generation on Android/Termux.
// No external inference API, database, framework or npm dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { writeEpub } = require('./epub');

const DATA = process.env.BOOK_DATA_DIR || path.join(os.homedir(), 'services', 'bookforge-data');
const BOOKS = path.join(DATA, 'books');
const MODEL = process.env.BOOK_MODEL || path.join(DATA, 'models', 'qwen2.5-1.5b-instruct-q4_k_m.gguf');
const SERVER = process.env.BOOK_LLAMA_SERVER || path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'llama-server');
const PORT = number('BOOK_PORT', 18081, 1024, 65535);
const CONTEXT = number('BOOK_CONTEXT', 2048, 1024, 8192);
const THREADS = number('BOOK_THREADS', 2, 1, 8);
const CHAPTERS = number('BOOK_CHAPTERS', 8, 1, 24);
const SCENES = number('BOOK_SCENES_PER_CHAPTER', 2, 1, 6);
const TOKENS = number('BOOK_MAX_TOKENS', 650, 128, 1500);
const INTERVAL_DAYS = number('BOOK_INTERVAL_DAYS', 15, 1, 365);
const MIN_MEMORY_MB = number('BOOK_MIN_AVAILABLE_MB', 1700, 0, 8192);
const URL = 'http://127.0.0.1:' + PORT;
const SYSTEM = 'Voce e um romancista especializado em suspense criminal. Escreva exclusivamente em portugues brasileiro, com prosa natural, personagens complexos, investigacao verossimil, pistas justas e final original. Evite plagio, repeticoes, resumos no lugar de cenas e referencias a obras existentes. Nao explique sua tarefa.';
let llama = null;
let stopping = false;
let active = false;
let unlockOnExit = null;

function number(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(name + ' deve ser inteiro entre ' + min + ' e ' + max);
  return n;
}
function log(message) { console.log(new Date().toISOString() + ' [bookforge] ' + message); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function ensureData() {
  fs.mkdirSync(BOOKS, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(DATA, 'models'), { recursive: true, mode: 0o700 });
}
function read(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function json(file, fallback = null) {
  const raw = read(file);
  return raw ? JSON.parse(raw) : fallback;
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, value, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, file);
}
function writeJson(file, value) { atomic(file, JSON.stringify(value, null, 2) + '\n'); }
function cut(value, length) { return String(value || '').slice(-length); }
function batteryTemperatureC() {
  const result = spawnSync('termux-battery-status', [], {
    encoding: 'utf8', timeout: 12000, maxBuffer: 10000
  });
  if (result.error || result.status !== 0) return null;
  try {
    const value = JSON.parse(result.stdout).temperature;
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}
async function waitForSafeTemperature() {
  const limit = number('BOOK_MAX_BATTERY_C', 42, 35, 55);
  let temperature = batteryTemperatureC();
  if (temperature === null) {
    log('Aviso: temperatura da bateria indisponivel; monitore o A30 e use pausas');
    return;
  }
  while (temperature >= limit && !stopping) {
    log('Bateria a ' + temperature + ' C (limite ' + limit + ' C). Pausando 5 min.');
    await sleep(5 * 60000);
    temperature = batteryTemperatureC();
    if (temperature === null) throw new Error('Sensor de bateria indisponivel apos alerta termico');
  }
  if (stopping) throw new Error('Encerramento solicitado');
}
function availableMB() {
  const info = read('/proc/meminfo');
  const match = info.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  return match ? Math.floor(Number(match[1]) / 1024) : null;
}
function doctor() {
  const available = availableMB();
  const result = {
    platform: process.platform, arch: process.arch, node: process.version,
    model: MODEL, modelExists: fs.existsSync(MODEL),
    server: SERVER, serverExists: fs.existsSync(SERVER),
    memoryAvailableMB: available, minimumMemoryMB: MIN_MEMORY_MB,
    data: DATA, chapters: CHAPTERS, scenesPerChapter: SCENES,
    context: CONTEXT, threads: THREADS, tokensPerScene: TOKENS
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.modelExists || !result.serverExists || available === null || available < MIN_MEMORY_MB) process.exitCode = 1;
}
function checkRuntime() {
  if (!fs.existsSync(MODEL)) throw new Error('Modelo GGUF ausente: ' + MODEL);
  if (!fs.existsSync(SERVER)) throw new Error('llama-server ausente: ' + SERVER);
  const free = availableMB();
  if (free === null) throw new Error('MemAvailable indisponivel; nao iniciar sem verificar a RAM real');
  if (free < MIN_MEMORY_MB) throw new Error('RAM disponivel: ' + free + ' MB; minimo configurado: ' + MIN_MEMORY_MB + ' MB');
}
async function startServer() {
  checkRuntime();
  try {
    const response = await fetch(URL + '/health', { signal: AbortSignal.timeout(1200) });
    if (response) throw new Error('Porta ' + PORT + ' ja esta em uso; nao reutilizar servidor desconhecido');
  } catch (error) {
    if (/ja esta em uso/.test(error.message)) throw error;
  }
  const args = ['-m', MODEL, '-c', String(CONTEXT), '-t', String(THREADS),
    '-np', '1', '-ngl', '0', '--host', '127.0.0.1', '--port', String(PORT), '--no-webui', '-a', 'bookforge-local'];
  llama = spawn(SERVER, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let recentError = '';
  let spawnError = null;
  llama.on('error', error => { spawnError = error; });
  llama.stderr.on('data', chunk => { recentError = cut(recentError + chunk.toString(), 1800); });
  log('Carregando modelo local; aguardando /health...');
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline && !stopping) {
    if (spawnError) throw spawnError;
    if (llama.exitCode !== null || llama.signalCode !== null) throw new Error('llama-server encerrou: ' + recentError);
    try {
      const response = await fetch(URL + '/health', { signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        const health = await response.json();
        if (health.status === 'ok') { log('Modelo pronto'); return; }
      }
    } catch { /* still loading */ }
    await sleep(3000);
  }
  throw new Error('Timeout iniciando llama-server: ' + recentError);
}
async function stopServer() {
  const child = llama;
  llama = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = new Promise(resolve => child.once('close', resolve));
  await Promise.race([exited, sleep(10000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
async function ask(prompt, maxTokens = TOKENS, minChars = 20) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (stopping) throw new Error('Encerramento solicitado');
    try {
      const response = await fetch(URL + '/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(2 * 60 * 60 * 1000),
        body: JSON.stringify({
          model: 'bookforge-local',
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
          max_tokens: maxTokens, temperature: 0.85, stream: false
        })
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + cut(await response.text(), 350));
      const payload = await response.json();
      const answer = payload.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || answer.trim().length < minChars) throw new Error('Resposta vazia/curta');
      return answer.trim() + '\n';
    } catch (error) {
      log('Tentativa ' + attempt + ' falhou: ' + error.message);
      if (attempt === 2) throw error;
      await sleep(5000);
    }
  }
}
async function checkpoint(file, prompt, maxTokens, minChars = 20) {
  const previous = read(file);
  if (previous.trim()) return previous;
  log('Gerando ' + path.relative(DATA, file));
  const output = await ask(prompt, maxTokens, minChars);
  atomic(file, output);
  return output;
}
function bookDirs() {
  ensureData();
  return fs.readdirSync(BOOKS).sort().map(name => path.join(BOOKS, name))
    .filter(dir => fs.statSync(dir).isDirectory());
}
function metadata(dir) { return json(path.join(dir, 'book.json')); }
function unfinished() {
  return bookDirs().find(dir => {
    const book = metadata(dir);
    return book && book.status === 'writing';
  });
}
function newBook() {
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') +
    '-' + crypto.randomBytes(3).toString('hex');
  const dir = path.join(BOOKS, id);
  fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
  writeJson(path.join(dir, 'book.json'), { id, title: null, status: 'writing',
    createdAt: new Date().toISOString(), chapters: CHAPTERS, scenesPerChapter: SCENES });
  return dir;
}
async function writeBook(dir) {
  const book = metadata(dir);
  const chapters = book.chapters;
  const scenes = book.scenesPerChapter;
  const titleRaw = await checkpoint(path.join(dir, 'title.txt'),
    'Crie um titulo curto, marcante e inedito para um suspense policial brasileiro contemporaneo. Responda somente com o titulo.', 100, 2);
  const title = titleRaw.trim().split('\n')[0].replace(/^["#* ]+|["#* ]+$/g, '').slice(0, 110) || 'Misterio sem Nome';
  const bible = await checkpoint(path.join(dir, 'bible.md'),
    'Planeje o romance policial "' + title + '". Crie uma biblia concisa com: cidade ficticia, protagonista, vitima, tres suspeitos, culpado e motivacao secreta, cinco pistas, duas pistas falsas, cronologia, reviravolta e resolucao. Defina a verdade do crime antes de escrever. Use topicos objetivos.', 700);
  const outline = await checkpoint(path.join(dir, 'outline.md'),
    'Titulo: ' + title + '\nBiblia:\n' + cut(bible, 2600) +
    '\nPlaneje ' + chapters + ' capitulos, com ' + scenes + ' cenas por capitulo. Indique para cada capitulo o conflito, pistas reveladas, progressao e gancho. A resolucao deve respeitar a biblia. Seja conciso.', 850);
  for (let c = 1; c <= chapters; c++) {
    for (let s = 1; s <= scenes; s++) {
      const file = path.join(dir, 'scenes', 'c' + c + '-s' + s + '.txt');
      const previous = s > 1 ? read(path.join(dir, 'scenes', 'c' + c + '-s' + (s - 1) + '.txt')) :
        c > 1 ? read(path.join(dir, 'scenes', 'c' + (c - 1) + '-s' + scenes + '.txt')) : '';
      const memory = [];
      for (let p = Math.max(1, c - 3); p < c; p++) {
        memory.push(read(path.join(dir, 'summaries', 'c' + p + '.txt')));
      }
      const prompt = 'Escreva SOMENTE a prosa narrativa da cena ' + s + ' de ' + scenes +
        ', capitulo ' + c + ' de ' + chapters + ', do romance "' + title + '".\n' +
        'Verdade do crime:\n' + cut(bible, 1700) + '\nPlano de capitulos:\n' + cut(outline, 1900) +
        '\nMemoria dos capitulos anteriores:\n' + cut(memory.join('\n'), 1200) +
        '\nTrecho final da cena anterior:\n' + cut(previous, 550) +
        '\nEscreva uma cena dramatizada, com dialogos e acoes, detalhes sensoriais, pistas coerentes, sem titulos nem comentarios metalinguisticos. Nao resolva o misterio antes do capitulo final.';
      if (!read(file).trim()) {
        await waitForSafeTemperature();
        await checkpoint(file, prompt, TOKENS);
        const pause = number('BOOK_COOLDOWN_SECONDS', 120, 0, 3600);
        if (pause) await sleep(pause * 1000);
      }
    }
    const chapterText = Array.from({ length: scenes }, (_, index) =>
      read(path.join(dir, 'scenes', 'c' + c + '-s' + (index + 1) + '.txt'))).join('\n\n');
    await checkpoint(path.join(dir, 'summaries', 'c' + c + '.txt'),
      'Resuma em ate 10 linhas os FATOS verificaveis, pistas, mudancas de relacionamento, locais e cronologia deste capitulo. Nao invente fatos novos.\n' +
      'Biblia: ' + cut(bible, 800) + '\nTexto do capitulo:\n' + cut(chapterText, 4200), 260);
  }
  const output = path.join(dir, 'livro.epub');
  const chapterEntries = Array.from({ length: chapters }, (_, i) => ({
    title: 'Capitulo ' + (i + 1),
    text: Array.from({ length: scenes }, (_, j) =>
      read(path.join(dir, 'scenes', 'c' + (i + 1) + '-s' + (j + 1) + '.txt'))).join('\n\n')
  }));
  writeEpub({ title, chapters: chapterEntries }, output);
  writeJson(path.join(dir, 'book.json'), { ...book, title, status: 'ready',
    completedAt: new Date().toISOString(), epub: output });
  log('EPUB pronto: ' + output);
  return dir;
}
function lock() {
  ensureData();
  const directory = path.join(DATA, '.run-lock');
  try { fs.mkdirSync(directory); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Ja existe uma execucao/lock. Verifique o PM2 antes de remover ' + directory);
    throw error;
  }
  fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, time: new Date().toISOString() }));
  const release = () => fs.rmSync(directory, { recursive: true, force: true });
  unlockOnExit = release;
  return () => { release(); unlockOnExit = null; };
}
function address(value) { return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value || ''); }
function submitKindle(dir, manual = false) {
  const book = metadata(dir);
  if (!book || book.status !== 'ready') throw new Error('Livro ainda nao esta pronto');
  const submitted = path.join(dir, 'submission.json');
  const failure = path.join(dir, 'send-error.json');
  if (fs.existsSync(submitted)) { log('Ja submetido ao SMTP; nao duplicar: ' + book.id); return; }
  if (!manual && fs.existsSync(failure)) { log('Falha anterior de envio; exige revisao manual: ' + book.id); return; }
  const from = process.env.BOOK_EMAIL_FROM;
  const to = process.env.BOOK_KINDLE_TO;
  if (!address(from) || !address(to)) throw new Error('Configure BOOK_EMAIL_FROM e BOOK_KINDLE_TO no ambiente privado');
  const file = path.join(dir, 'livro.epub');
  const encoded = fs.readFileSync(file).toString('base64').match(/.{1,76}/g).join('\r\n');
  const boundary = 'bookforge-' + crypto.randomBytes(12).toString('hex');
  const message = [
    'From: ' + from, 'To: ' + to, 'Subject: Livro para Kindle',
    'MIME-Version: 1.0', 'Date: ' + new Date().toUTCString(),
    'Content-Type: multipart/mixed; boundary="' + boundary + '"', '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', '',
    'Livro gerado localmente no A30.', '--' + boundary,
    'Content-Type: application/epub+zip; name="livro.epub"',
    'Content-Disposition: attachment; filename="livro.epub"',
    'Content-Transfer-Encoding: base64', '', encoded,
    '--' + boundary + '--', ''
  ].join('\r\n');
  const result = spawnSync('msmtp', ['-t'], { input: message, encoding: 'utf8', timeout: 120000, maxBuffer: 128 * 1024 });
  if (result.error || result.status !== 0) {
    writeJson(failure, { at: new Date().toISOString(), error: cut(result.stderr || result.error?.message || 'msmtp falhou', 500) });
    throw new Error('SMTP nao confirmou aceite; verificar antes de repetir para evitar duplicata');
  }
  writeJson(submitted, { at: new Date().toISOString(), status: 'accepted-by-smtp',
    kindleAddress: to, note: 'Aceite SMTP nao comprova entrega ao Kindle' });
  if (fs.existsSync(failure)) fs.unlinkSync(failure);
  log('SMTP aceitou o EPUB; entrega no Kindle ainda nao confirmada');
}
function scheduleNext() {
  writeJson(path.join(DATA, 'schedule.json'), { nextRunAt: new Date(Date.now() + INTERVAL_DAYS * 86400000).toISOString() });
}
async function run() {
  const unlock = lock();
  active = true;
  try {
    const dir = unfinished() || newBook();
    log('Livro: ' + path.basename(dir));
    await startServer();
    try { await writeBook(dir); }
    finally { await stopServer(); }
    scheduleNext();
    if (process.env.BOOK_AUTO_SEND === '1') {
      try { submitKindle(dir); }
      catch (error) { log('EPUB salvo, mas envio pendente: ' + error.message); }
    }
  } finally {
    await stopServer();
    active = false;
    unlock();
  }
}
async function daemon() {
  ensureData();
  if (!json(path.join(DATA, 'schedule.json'))) scheduleNext();
  log('Agendador ativo: intervalo de ' + INTERVAL_DAYS + ' dias');
  while (!stopping) {
    const schedule = json(path.join(DATA, 'schedule.json'));
    if (schedule && Date.now() >= Date.parse(schedule.nextRunAt)) {
      try { await run(); }
      catch (error) {
        log('Erro: ' + error.stack);
        writeJson(path.join(DATA, 'schedule.json'), { nextRunAt: new Date(Date.now() + 6 * 3600000).toISOString() });
      }
    }
    await sleep(60000);
  }
}
function status() {
  ensureData();
  const books = bookDirs().map(dir => ({ ...metadata(dir),
    submitted: fs.existsSync(path.join(dir, 'submission.json')),
    sendError: fs.existsSync(path.join(dir, 'send-error.json')) }));
  console.log(JSON.stringify({ schedule: json(path.join(DATA, 'schedule.json')), books }, null, 2));
}
process.on('exit', () => { if (unlockOnExit) { try { unlockOnExit(); } catch {} } });
function requestStop() {
  stopping = true;
  if (llama) llama.kill('SIGTERM');
  process.exit(0); // exit handler removes our own lock
}
process.on('SIGTERM', requestStop);
process.on('SIGINT', requestStop);

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'doctor') return doctor();
  if (command === 'status') return status();
  if (command === 'run') return run();
  if (command === 'daemon') return daemon();
  if (command === 'send') {
    const id = process.argv[3];
    const dir = id ? path.join(BOOKS, path.basename(id)) :
      bookDirs().reverse().find(d => metadata(d)?.status === 'ready' && !fs.existsSync(path.join(d, 'submission.json')));
    if (!dir) throw new Error('Nenhum EPUB pronto e pendente');
    return submitKindle(dir, true);
  }
  console.log('Uso: node bookforge.js doctor | run | daemon | status | send [ID]\n' +
    'Primeiro execute doctor e run manualmente. Leia bookforge/README.md.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { availableMB, address, number };
