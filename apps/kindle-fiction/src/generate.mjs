#!/usr/bin/env node
/**
 * Gerador local e retomável de ficção policial para Termux.
 * Sem APIs pagas, sem envio de e-mail e sem alterar serviços do homelab.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createEpub } from './epub.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = process.env.FICTION_CONFIG || path.join(APP, 'config.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);

function expandHome(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Caminho inválido');
  return value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : path.resolve(APP, value);
}
async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
async function readOptional(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function saveAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, content, { mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
async function saveJson(file, value) {
  await saveAtomic(file, JSON.stringify(value, null, 2) + '\n');
}
async function loadConfig() {
  const c = JSON.parse(await fs.readFile(configFile, 'utf8'));
  for (const field of ['modelPath', 'llamaServerPath']) {
    if (!c[field]) throw new Error('Falta ' + field + ' em ' + configFile);
  }
  c.modelPath = expandHome(c.modelPath);
  c.llamaServerPath = expandHome(c.llamaServerPath);
  c.dataDir = expandHome(c.dataDir || 'data');
  c.chapters = Number(c.chapters ?? 4);
  c.contextSize = Number(c.contextSize ?? 2048);
  c.tokensPerChapter = Number(c.tokensPerChapter ?? 900);
  c.threads = Number(c.threads ?? 3);
  c.port = Number(c.port ?? 18089);
  c.minAvailableMB = Number(c.minAvailableMB ?? 1100);
  c.temperature = Number(c.temperature ?? 0.85);
  if (!Number.isInteger(c.chapters) || c.chapters < 1 || c.chapters > 30) throw new Error('chapters deve ser 1..30');
  if (!Number.isInteger(c.contextSize) || c.contextSize < 1024 || c.contextSize > 8192) throw new Error('contextSize inválido');
  if (!Number.isInteger(c.tokensPerChapter) || c.tokensPerChapter < 128 || c.tokensPerChapter > c.contextSize - 256) throw new Error('tokensPerChapter deve caber no contexto');
  if (!Number.isInteger(c.threads) || c.threads < 1 || c.threads > 8) throw new Error('threads inválido');
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw new Error('port inválida');
  if (!Number.isFinite(c.minAvailableMB) || c.minAvailableMB < 0) throw new Error('minAvailableMB inválido');
  if (!Number.isFinite(c.temperature) || c.temperature < 0 || c.temperature > 2) throw new Error('temperature inválida');
  return c;
}
async function guardMemory(minMB) {
  if (minMB === 0) return;
  let info;
  try { info = await fs.readFile('/proc/meminfo', 'utf8'); }
  catch { log('Aviso: /proc/meminfo indisponível; não é possível avaliar RAM livre'); return; }
  const match = info.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  if (!match) { log('Aviso: MemAvailable indisponível; verifique a RAM manualmente'); return; }
  const availableMB = Number(match[1]) / 1024;
  log('RAM disponível estimada:', availableMB.toFixed(0), 'MiB');
  if (availableMB < minMB) throw new Error('RAM disponível abaixo do mínimo (' + minMB + ' MiB). Nenhum modelo foi carregado.');
}
async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error('Porta local ' + port + ' indisponível: ' + error.message)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
function startServer(c) {
  const args = ['-m', c.modelPath, '-c', String(c.contextSize), '-t', String(c.threads),
    '-ngl', '0', '-np', '1', '--host', '127.0.0.1', '--port', String(c.port), '--no-warmup'];
  log('Iniciando llama-server local em 127.0.0.1:' + c.port);
  const child = spawn(c.llamaServerPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  child.spawnFailure = null;
  child.on('error', err => { child.spawnFailure = err; });
  return child;
}
async function waitServer(child, port) {
  const url = 'http://127.0.0.1:' + port + '/health';
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (child.spawnFailure) throw child.spawnFailure;
    if (child.exitCode !== null) throw new Error('llama-server encerrou antes de ficar pronto: ' + child.exitCode);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (r.ok) return;
    } catch { /* aguarda carregar o modelo */ }
    await delay(2000);
  }
  throw new Error('llama-server não respondeu em 4 minutos');
}
async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(8000)
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
async function complete(c, messages, maxTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120 * 60 * 1000);
  try {
    const r = await fetch('http://127.0.0.1:' + c.port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'local',
        messages: [{ role: 'system', content: 'Você é um romancista brasileiro de suspense policial. Escreva somente em português brasileiro. Crie ficção original, consistente, sem comentários metalinguísticos e sem copiar livros existentes.' }, { role: 'user', content: messages }],
        stream: false, max_tokens: maxTokens, temperature: c.temperature, top_p: 0.92
      }),
      signal: controller.signal
    });
    if (!r.ok) throw new Error('llama-server HTTP ' + r.status + ': ' + (await r.text()).slice(0, 500));
    const payload = await r.json();
    const value = payload.choices?.[0]?.message?.content;
    if (typeof value !== 'string' || !value.trim()) throw new Error('Modelo não produziu texto');
    return value.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } finally { clearTimeout(timeout); }
}
async function generate() {
  const c = await loadConfig();
  if (!(await exists(c.modelPath))) throw new Error('Modelo GGUF não encontrado: ' + c.modelPath);
  if (!(await exists(c.llamaServerPath))) throw new Error('llama-server não encontrado: ' + c.llamaServerPath);
  await fs.mkdir(c.dataDir, { recursive: true });
  const lockPath = path.join(c.dataDir, 'generation.lock');
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx', 0o600);
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error('Geração já bloqueada. Se houve encerramento abrupto, confira processos antes de remover generation.lock.');
    throw e;
  }
  let server;
  try {
    const stateFile = path.join(c.dataDir, 'current.json');
    const previous = await readOptional(stateFile);
    let state = previous ? JSON.parse(previous) : null;
    if (!state || state.status === 'complete') {
      state = {
        id: new Date().toISOString().slice(0, 10) + '-' + randomUUID().slice(0, 8),
        uuid: randomUUID(),
        status: 'working',
        createdAt: new Date().toISOString(),
        chapters: c.chapters
      };
      await saveJson(stateFile, state);
    }
    if (state.chapters !== c.chapters) throw new Error('Livro em andamento usa chapters=' + state.chapters + '; mantenha a configuração até terminar');
    const dir = path.join(c.dataDir, 'books', state.id);
    await fs.mkdir(path.join(dir, 'chapters'), { recursive: true });
    await fs.mkdir(path.join(dir, 'summaries'), { recursive: true });
    await guardMemory(c.minAvailableMB);
    await assertPortFree(c.port);
    server = startServer(c);
    await waitServer(server, c.port);

    const planFile = path.join(dir, 'plan.md');
    let plan = await readOptional(planFile);
    if (!plan) {
      log('Gerando planejamento do romance', state.id);
      plan = await complete(c, [
        'Crie um plano ORIGINAL de suspense criminal ambientado no Brasil.',
        'Primeira linha obrigatória: TÍTULO: nome curto e original.',
        'Depois descreva protagonista, vítima, investigador, três suspeitos, culpado verdadeiro, motivo, pistas plantadas, pistas falsas, linha do tempo e desfecho.',
        'Planeje exatamente ' + c.chapters + ' capítulos numerados. Cada capítulo deve ter um acontecimento e um gancho. Revele o culpado somente no último.',
        'O texto deve ser um plano de bastidores, não o romance. Evite clichês e inconsistências.'
      ].join('\n'), Math.min(900, c.contextSize - 512));
      await saveAtomic(planFile, plan + '\n');
    }
    const titleMatch = plan.match(/(?:^|\n)\s*T[IÍ]TULO:\s*(.+)/i);
    const title = (titleMatch?.[1] || 'Mistério da Madrugada').trim().slice(0, 100);
    const summaries = [];
    for (let i = 1; i <= c.chapters; i++) {
      const num = String(i).padStart(2, '0');
      const chapterFile = path.join(dir, 'chapters', num + '.md');
      const summaryFile = path.join(dir, 'summaries', num + '.txt');
      let chapter = await readOptional(chapterFile);
      if (!chapter) {
        log('Gerando capítulo', i, 'de', c.chapters);
        const memory = summaries.slice(-3).map((s, j) => 'Resumo anterior ' + (Math.max(1, i - summaries.slice(-3).length) + j) + ':\n' + s.slice(0, 300)).join('\n');
        const prompt = [
          'Romance: ' + title,
          'PLANO GERAL:\n' + plan.slice(0, 2100),
          'CONTINUIDADE:\n' + (memory || 'Início da história.'),
          'Escreva SOMENTE o texto literário do CAPÍTULO ' + i + ' de ' + c.chapters + '.',
          'Use cenas, diálogos naturais, investigação plausível, tensão crescente, detalhes sensoriais e prosa fluida.',
          'Respeite o plano, as pistas, a cronologia e os nomes. Não resuma os eventos; dramatize-os.',
          i === c.chapters ? 'Conclua o mistério e resolva o arco central.' : 'Termine com um gancho narrativo, sem resolver o mistério.',
          'Não inclua notas ao leitor nem explicações sobre IA. Comece diretamente pela narrativa.'
        ].join('\n\n');
        chapter = await complete(c, prompt, c.tokensPerChapter);
        if (chapter.length < 250) throw new Error('Capítulo ' + i + ' curto demais; tente novamente');
        await saveAtomic(chapterFile, chapter + '\n');
      } else log('Capítulo', i, 'já salvo; pulando geração');
      let summary = await readOptional(summaryFile);
      if (!summary) {
        log('Resumindo capítulo', i);
        summary = await complete(c, 'Resuma em até 130 palavras os FATOS canônicos deste capítulo para manter continuidade: nomes, pistas, descobertas, locais, eventos e estado da investigação. Não invente fatos.\n\n' + chapter.slice(-6500), 260);
        await saveAtomic(summaryFile, summary + '\n');
      }
      summaries.push(summary);
      state.lastChapter = i;
      await saveJson(stateFile, state);
    }
    const epubFile = path.join(dir, 'livro.epub');
    await createEpub({
      title, author: 'Ficção gerada localmente — uso pessoal', uuid: state.uuid,
      chapters: await Promise.all(Array.from({ length: c.chapters }, async (_, i) => {
        const num = String(i + 1).padStart(2, '0');
        return await fs.readFile(path.join(dir, 'chapters', num + '.md'), 'utf8');
      })),
      outputPath: epubFile
    });
    state.status = 'complete';
    state.title = title;
    state.completedAt = new Date().toISOString();
    state.epubPath = epubFile;
    await saveJson(stateFile, state);
    log('EPUB concluído:', epubFile);
    log('Envio ao Kindle não habilitado neste MVP. Revise o livro antes de enviar.');
  } finally {
    await stopServer(server);
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}
generate().catch(err => { console.error(new Date().toISOString(), err.stack || err); process.exitCode = 1; });
