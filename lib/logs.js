const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { command } = require('./collectors');

const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
const SERVICES = ['homelab-status', 'homelab-watchdog', 'bom-dia', 'minecraft', 'playit', 'cloudflare-tunnel', 'tailscale-userspace'];
const MAX_BYTES = 65536;
const MAX_LINES = 160;

function redact(value) {
  return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/\b(Bearer)\s+[^\s"']+/gi, '$1 [redigido]')
    .replace(/\b(token|password|passwd|secret|api[_-]?key|authorization|credential)\b\s*[:=]\s*["']?[^\s,;"'}]+/gi, '$1=[redigido]')
    .replace(/\b(cf[a-z_-]*token|rcon\.password)\b\s*[:=]\s*["']?[^\s,;"'}]+/gi, '$1=[redigido]');
}
function approvedLogPath(file, service, stream, home = os.homedir()) {
  if (typeof file !== 'string' || !SERVICES.includes(service) || !['out', 'error'].includes(stream)) return false;
  const allowedRoots = [path.join(home, '.pm2/logs'), path.join(home, 'services/logs')];
  const resolved = path.resolve(file);
  if (!allowedRoots.some(root => resolved.startsWith(root + path.sep))) return false;
  const base = path.basename(resolved);
  return base.startsWith(service + '-' + (stream === 'out' ? 'out' : 'error')) && base.endsWith('.log');
}
async function tailFile(file, size = MAX_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Arquivo de log inválido');
    const length = Math.min(size, info.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, info.size - length);
    const value = buffer.toString('utf8');
    return redact(value.slice(info.size > length ? value.indexOf('\n') + 1 : 0).split('\n').slice(-MAX_LINES).join('\n'));
  } finally { await handle.close(); }
}
async function pm2Entries(run = command) {
  const cli = path.join(PREFIX, 'lib/node_modules/pm2/bin/pm2');
  const result = await run(process.execPath, [cli, 'jlist'], 5);
  if (!result.ok) throw new Error('PM2 indisponível');
  const entries = JSON.parse(result.text);
  if (!Array.isArray(entries)) throw new Error('Resposta PM2 inválida');
  return entries.filter(p => SERVICES.includes(p.name));
}
async function listLogSources(run = command) {
  const entries = await pm2Entries(run);
  return SERVICES.map(id => ({ id, available: entries.some(p => p.name === id) }));
}
async function readServiceLogs(service, stream = 'out', { run = command, home = os.homedir(),
  readTail = tailFile } = {}) {
  if (!SERVICES.includes(service) || !['out', 'error'].includes(stream))
    throw Object.assign(new Error('Serviço ou tipo de log inválido'), { status: 400 });
  const entries = (await pm2Entries(run)).filter(p => p.name === service);
  if (entries.length !== 1) throw Object.assign(new Error('Registro PM2 não confirmado'), { status: 404 });
  const file = entries[0].pm2_env?.[stream === 'out' ? 'pm_out_log_path' : 'pm_err_log_path'];
  if (!approvedLogPath(file, service, stream, home))
    throw Object.assign(new Error('Caminho de log recusado'), { status: 403 });
  try {
    const real = await fs.realpath(file);
    const realHome = await fs.realpath(home);
    if (!approvedLogPath(real, service, stream, realHome))
      throw Object.assign(new Error('Caminho de log recusado'), { status: 403 });
    return { service, stream, text: await readTail(real), truncatedToBytes: MAX_BYTES, maxLines: MAX_LINES };
  }
  catch (error) {
    if (error.code === 'ENOENT') return { service, stream, text: '', truncatedToBytes: MAX_BYTES, maxLines: MAX_LINES };
    throw error;
  }
}
async function readCombinedLogs(stream = 'out', { run = command, home = os.homedir(), readTail = tailFile } = {}) {
  if (!['out', 'error'].includes(stream)) throw Object.assign(new Error('Tipo de log inválido'), { status: 400 });
  const entries = await pm2Entries(run);
  const sections = await Promise.all(SERVICES.map(async service => {
    const matches = entries.filter(p => p.name === service);
    if (matches.length !== 1) return null;
    const file = matches[0].pm2_env?.[stream === 'out' ? 'pm_out_log_path' : 'pm_err_log_path'];
    if (!approvedLogPath(file, service, stream, home)) return null;
    try {
      const real = await fs.realpath(file);
      const realHome = await fs.realpath(home);
      if (!approvedLogPath(real, service, stream, realHome)) return null;
      const lines = (await readTail(real, 8192)).split('\n').slice(-24).join('\n');
      return '── ' + service + ' ──\n' + (lines || 'Nenhuma linha neste canal.');
    } catch { return null; }
  }));
  return { service: 'all', stream, text: sections.filter(Boolean).join('\n\n').slice(-48000),
    note: 'Últimas linhas agrupadas por serviço; a ordem entre serviços não representa cronologia.' };
}
module.exports = { SERVICES, redact, approvedLogPath, tailFile, listLogSources, readServiceLogs, readCombinedLogs };
