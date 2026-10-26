#!/usr/bin/env node
/** Agendador conservador: só gera se schedule.enabled=true no config privado. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = process.env.FICTION_CONFIG || path.join(APP, 'config.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);
let busy = false;
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });

async function writeAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }); }
}
async function tick() {
  if (busy || stopped) return;
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  if (!config.schedule?.enabled) return;
  const intervalDays = Number(config.schedule.intervalDays || 15);
  const retryHours = Number(config.schedule.retryHours || 6);
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) throw new Error('intervalDays inválido');
  if (!Number.isInteger(retryHours) || retryHours < 1 || retryHours > 168) throw new Error('retryHours inválido');
  const dataDir = config.dataDir?.startsWith('~/')
    ? path.join(process.env.HOME, config.dataDir.slice(2))
    : path.resolve(APP, config.dataDir || 'data');
  const file = path.join(dataDir, 'scheduler.json');
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; state = { nextRunAt: new Date().toISOString() }; }
  if (Date.now() < Date.parse(state.nextRunAt)) return;
  busy = true;
  try {
    log('Iniciando livro agendado');
    const child = spawn(process.execPath, [path.join(APP, 'src/generate.mjs')], {
      cwd: APP, env: { ...process.env, FICTION_CONFIG: configFile }, stdio: 'inherit'
    });
    const result = await new Promise(resolve => {
      child.on('error', error => { log('Falha ao iniciar worker:', error.message); resolve(1); });
      child.on('close', code => resolve(code ?? 1));
    });
    const delayMs = (result === 0 ? intervalDays * 24 : retryHours) * 3600000;
    state = { nextRunAt: new Date(Date.now() + delayMs).toISOString(), lastExitCode: result, lastAttemptAt: new Date().toISOString() };
    await writeAtomic(file, state);
    log('Worker encerrou com código', result, '; próxima tentativa:', state.nextRunAt);
  } finally { busy = false; }
}
log('Agendador ativo; configuração padrão NÃO executa automaticamente.');
while (!stopped) {
  try { await tick(); } catch (e) { console.error(new Date().toISOString(), e.stack || e); }
  await pause(60000);
}
