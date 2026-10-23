#!/usr/bin/env node
/** Diagnóstico SOMENTE LEITURA; não inicia IA nem altera o Termux. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expand = p => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(APP, p);
console.log('Plataforma:', process.platform, process.arch, 'Node:', process.version);
console.log('RAM total (MiB):', Math.round(os.totalmem() / 1048576));
console.log('RAM livre (MiB):', Math.round(os.freemem() / 1048576));
try {
  const mem = await fs.readFile('/proc/meminfo', 'utf8');
  console.log('MemAvailable:', mem.match(/^MemAvailable:\s+.+/m)?.[0] || 'indisponível');
} catch { console.log('MemAvailable: indisponível'); }
try {
  const config = JSON.parse(await fs.readFile(process.env.FICTION_CONFIG || path.join(APP, 'config.json'), 'utf8'));
  for (const [label, p] of [['GGUF', config.modelPath], ['llama-server', config.llamaServerPath]]) {
    try {
      const stat = await fs.stat(expand(p));
      console.log(label + ':', expand(p), 'OK', Math.round(stat.size / 1048576) + ' MiB');
    } catch { console.log(label + ': NÃO ENCONTRADO', expand(p)); }
  }
} catch { console.log('config.json não encontrado; copie config.example.json'); }
for (const command of ['zip', 'git', 'cmake']) {
  const r = spawnSync('sh', ['-c', 'command -v ' + command], { encoding: 'utf8' });
  console.log(command + ':', r.status === 0 ? r.stdout.trim() : 'não encontrado');
}
console.log('Nenhum serviço ou configuração foi alterado.');
