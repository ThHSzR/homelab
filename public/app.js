const $ = id => document.getElementById(id);
const bytes = n => n == null ? '—' : (n / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB';
const duration = n => { n = Math.max(0, Math.floor(n || 0)); const d = Math.floor(n / 86400), h = Math.floor(n % 86400 / 3600), m = Math.floor(n % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'm'; };
const labels = { online: 'Online', stopped: 'Parado', offline: 'Offline', unknown: 'Sem leitura', unmanaged: 'Sem PM2', errored: 'Erro', launching: 'Iniciando', possible: 'Possível' };
function el(tag, text, cls) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
let latestStatus = null;
let latestHealth = null;

const diagnosticKey = 'homelab.connection.debug.v1';
let diagnosticHistory = [];
try { diagnosticHistory = JSON.parse(sessionStorage.getItem(diagnosticKey) || '[]'); }
catch { diagnosticHistory = []; }

function safeResponseUrl(value) {
  if (!value) return '—';
  try {
    const url = new URL(value, location.href);
    return url.origin === location.origin ? url.pathname : url.origin + url.pathname;
  } catch { return '—'; }
}

function renderDiagnostics() {
  const log = $('debug-log');
  const summary = $('debug-summary');
  if (!log || !summary) return;
  const last = diagnosticHistory.at(-1);
  summary.textContent = last
    ? last.kind + ' · ' + last.result + ' · ' + last.elapsedMs + ' ms'
    : 'Aguardando primeira requisição';

  const lines = diagnosticHistory.slice(-16).reverse().map(item => {
    const parts = [
      item.time,
      item.kind.toUpperCase(),
      item.result,
      item.status ? 'HTTP ' + item.status : null,
      item.origin ? 'origin=' + item.origin : null,
      item.type ? 'type=' + item.type : null,
      item.url ? 'url=' + item.url : null,
      item.cfRay ? 'cf-ray=' + item.cfRay : null,
      item.error ? 'error=' + item.error : null,
      item.online == null ? null : 'online=' + item.online,
      item.visibility ? 'visibility=' + item.visibility : null
    ].filter(Boolean);
    return parts.join(' · ');
  });
  log.textContent = lines.join('\n');
}

function recordDiagnostic(kind, fields) {
  const item = {
    time: new Date().toLocaleTimeString('pt-BR'),
    kind,
    online: navigator.onLine,
    visibility: document.visibilityState,
    ...fields
  };
  diagnosticHistory.push(item);
  diagnosticHistory = diagnosticHistory.slice(-40);
  try { sessionStorage.setItem(diagnosticKey, JSON.stringify(diagnosticHistory)); } catch {}
  renderDiagnostics();
}

async function diagnosticFetch(path, kind) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), 10000);
  try {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(path + separator + '_=' + Date.now(), {
      cache: 'no-store',
      credentials: 'include',
      redirect: 'manual',
      signal: controller.signal
    });
    const elapsedMs = Math.round(performance.now() - started);
    const opaqueRedirect = response.type === 'opaqueredirect' || response.status === 0;
    recordDiagnostic(kind, {
      result: opaqueRedirect ? 'REDIRECT/ACCESS' : response.ok ? 'OK' : 'HTTP_ERROR',
      status: response.status || null,
      elapsedMs,
      origin: response.headers.get('x-homelab-origin') || null,
      requestId: response.headers.get('x-homelab-request-id') || null,
      cfRay: response.headers.get('cf-ray') || null,
      type: response.type,
      url: safeResponseUrl(response.url),
      contentType: response.headers.get('content-type') || null
    });
    if (opaqueRedirect) {
      const error = new Error('Redirecionamento interceptado antes da API');
      error.code = 'ACCESS_REDIRECT';
      throw error;
    }
    return response;
  } catch (error) {
    if (error.code !== 'ACCESS_REDIRECT') {
      recordDiagnostic(kind, {
        result: controller.signal.aborted ? 'TIMEOUT' : 'FETCH_ERROR',
        elapsedMs: Math.round(performance.now() - started),
        error: error?.name + ': ' + (error?.message || String(error))
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function render(data) {
  $('connection').className = 'banner' + (data.stale ? ' warn' : '');
  $('connection').textContent = data.stale ? 'Dados desatualizados · verificando coletores' : '● Central conectada · última leitura às ' + new Date(data.timestamp).toLocaleTimeString('pt-BR');
  $('clock').textContent = new Date(data.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  $('uptime').textContent = duration(data.uptimeSeconds);
  $('app-uptime').textContent = 'Central ativa há ' + duration(data.appUptimeSeconds);
  const used = data.memory.totalBytes - data.memory.freeBytes;
  $('memory').textContent = bytes(used);
  $('memory-detail').textContent = bytes(data.memory.freeBytes) + ' livres de ' + bytes(data.memory.totalBytes);
  $('memory-bar').style.width = Math.min(100, Math.max(0, used / data.memory.totalBytes * 100)) + '%';
  $('disk').textContent = data.disk ? data.disk.percent + '%' : 'Indisponível';
  $('disk-detail').textContent = data.disk ? bytes(data.disk.availableBytes) + ' livres de ' + bytes(data.disk.totalBytes) : 'Sem permissão para leitura';
  $('disk-bar').style.width = Math.min(100, Math.max(0, data.disk?.percent || 0)) + '%';
  $('battery').textContent = data.battery.available ? data.battery.percentage + '%' : 'Sem leitura';
  $('battery-detail').textContent = data.battery.available ? (data.battery.temperature ?? '—') + ' °C · ' + ({ CHARGING: 'Carregando', DISCHARGING: 'Em uso', FULL: 'Carga completa', NOT_CHARGING: 'Sem carregar' }[data.battery.status] || data.battery.status || '') : data.battery.reason;
  $('tail-ip').textContent = data.tailscale.ip || 'Não detectado';
  $('tail-status').textContent = data.tailscale.detected ? 'Interface ' + data.tailscale.interface + ' ativa · alcance remoto não verificado' : 'Nenhuma interface da rede privada detectada';
  const boot = data.persistence.lastRun;
  $('boot-state').textContent = data.persistence.bootScriptRanThisBoot ? 'Script executado neste boot' : 'Teste de reboot pendente';
  $('boot-detail').textContent = boot ? 'Última execução: ' + new Date(boot.timestamp).toLocaleString('pt-BR') + (boot.source === 'manual-test' ? ' · teste manual' : '') : 'Aguardando primeira execução do script';
  $('service-count').textContent = data.services.filter(s => s.state === 'online').length + ' de ' + data.services.length + ' ativos';
  $('service-list').replaceChildren(...data.services.map(s => {
    const row = el('div', '', 'service');
    const title = el('div', ''); title.append(el('strong', s.name), el('small', s.description));
    row.append(el('span', s.id === 'sshd' ? '⌘' : '▦', 'icon'), title, el('span', s.port ? ':' + s.port : '—', 'meta port'), el('span', s.manager, 'meta manager'), el('span', labels[s.state] || s.state, 'status ' + s.state));
    return row;
  }));
}
let busy = false;
async function update() {
  if (busy) return;
  busy = true;
  try {
    const response = await diagnosticFetch('/api/status', 'status');
    if (!response.ok) throw new Error(response.status === 503 ? 'Coleta inicial em andamento' : 'Falha ao consultar a central');
    const data = await response.json();
    latestStatus = data;
    render(data);
    renderInsights();
  } catch (error) {
    renderInsights();
    $('connection').className = 'banner warn';
    const reason = error.code === 'ACCESS_REDIRECT'
      ? 'Cloudflare redirecionou a atualização antes de chegar à API'
      : error.message === 'Coleta inicial em andamento'
        ? error.message
        : 'Central sem resposta · ' + (error.name || 'erro de rede');
    $('connection').textContent = reason + '. Mantendo a última leitura válida e tentando novamente.';
  } finally { busy = false; }
}
async function modules() {
  try {
    const response = await diagnosticFetch('/api/modules', 'modules');
    if (!response.ok) throw new Error();
    const data = await response.json();
    $('module-list').replaceChildren(...data.map(m => {
      const card = el('article', '', 'module');
      card.append(el('span', { active: 'ATIVO', existing: 'EXISTENTE', planned: 'PLANEJADO' }[m.state], 'tag'), el('strong', m.name), el('p', m.description));
      return card;
    }));
  } catch { $('module-list').textContent = 'Não foi possível carregar os módulos.'; }
}
$('refresh').addEventListener('click', () => { update(); modules(); });
update(); modules(); setInterval(update, 15000);
renderDiagnostics();
window.addEventListener('online', () => { recordDiagnostic('browser', { result: 'ONLINE', elapsedMs: 0 }); update(); health(); });
window.addEventListener('offline', () => recordDiagnostic('browser', { result: 'OFFLINE', elapsedMs: 0 }));
window.addEventListener('focus', () => { recordDiagnostic('browser', { result: 'FOCUS', elapsedMs: 0 }); update(); health(); });
document.addEventListener('visibilitychange', () => {
  recordDiagnostic('browser', { result: document.visibilityState.toUpperCase(), elapsedMs: 0 });
  if (document.visibilityState === 'visible') { update(); health(); }
});

const healthNames = { dashboard: 'Dashboard · :3000', ssh: 'SSH · :8022', 'bom-dia': 'Bom Dia · runit', external: 'Conectividade externa', minecraft: 'Minecraft · Java' };
async function health() {
  try {
    const response = await diagnosticFetch('/api/health', 'health');
    if (!response.ok) throw new Error();
    const data = await response.json();
    $('health-summary').textContent = data.stale ? 'Monitor sem leitura recente' : 'Última leitura: ' + new Date(data.timestamp).toLocaleTimeString('pt-BR');
    $('health-list').replaceChildren(...Object.entries(data.services).map(([id, s]) => {
      const card = el('article', '', 'panel');
      card.append(el('strong', healthNames[id] || id), el('p', data.stale ? 'Dados desatualizados' : labels[s.status] || s.status, 'status ' + (data.stale ? 'unknown' : s.status)),
        el('p', s.latencyMs + ' ms · duração da verificação'),
        el('small', 'Última mudança: ' + new Date(s.changedAt).toLocaleString('pt-BR')),
        el('small', 'Visto online: ' + (s.lastSeen ? new Date(s.lastSeen).toLocaleString('pt-BR') : 'Ainda não')));
      const recent = data.history.slice(-20);
      const strip = el('div', '', 'health-history');
      recent.forEach(row => {
        const status = row.services[id]?.status || 'unknown';
        const dot = el('span', '', 'health-dot ' + status);
        dot.title = new Date(row.timestamp).toLocaleString('pt-BR') + ' · ' + (labels[status] || status);
        strip.append(dot);
      });
      strip.setAttribute('aria-label', 'Últimas ' + recent.length + ' verificações; verde indica online');
      card.append(strip);
      return card;
    }));
    latestHealth = data;
    renderInsights();
    renderMinecraft(data.services.minecraft, data.stale);
    $('health-recovery').textContent = (data.recovery.enabled ? 'Recuperação bom-dia habilitada' : 'Recuperação automática desativada') +
      ' · ' + data.recovery.attempts + '/3 tentativas usadas · cooldown de 10 min.' +
      (data.recovery.locked ? ' Recuperação bloqueada: verifique o arquivo de estado.' : '') +
      (data.recovery.lastResult ? ' ' + data.recovery.lastResult + '.' : '') +
      (data.recovery.recommendation ? ' ' + data.recovery.recommendation : '');
  } catch {
    $('health-summary').textContent = 'Monitor indisponível · dados anteriores podem estar desatualizados';
    $('health-list').replaceChildren(el('p', 'Aguardando nova leitura do watchdog.', 'empty'));
    latestHealth = null;
    renderInsights();
    renderMinecraft(null, true);
  }
}
$('refresh').addEventListener('click', health);
health(); setInterval(health, 15000);

function renderMinecraft(minecraft, stale) {
  if (!minecraft || stale) {
    $('minecraft-updated').textContent = 'Sem leitura recente';
    $('minecraft-state').textContent = 'Aguardando monitor';
    $('minecraft-detail').textContent = 'Dados indisponíveis ou desatualizados';
    $('minecraft-memory').textContent = '—';
    $('minecraft-cpu').textContent = '—';
    $('minecraft-players').textContent = '—';
    $('minecraft-process').textContent = 'Verifique o processo homelab-watchdog no PM2.';
    return;
  }
  $('minecraft-updated').textContent = 'Porta :' + (minecraft.port || 25565);
  $('minecraft-state').textContent = ({ online: 'Servidor respondendo', possible: 'Porta aberta · não confirmado', offline: 'Servidor indisponível' })[minecraft.status] || 'Sem leitura';
  $('minecraft-detail').textContent = minecraft.detail + (minecraft.version ? ' · ' + minecraft.version : '');
  $('minecraft-memory').textContent = minecraft.process?.rssBytes == null ? '—' :
    (minecraft.process.rssBytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' MB' +
    (minecraft.process.memoryPercent == null ? '' : ' · ' + minecraft.process.memoryPercent.toLocaleString('pt-BR') + '% da RAM');
  $('minecraft-cpu').textContent = minecraft.process?.cpuPercent == null ? 'Aguardando 2ª leitura' : minecraft.process.cpuPercent + '%';
  $('minecraft-players').textContent = minecraft.players == null ? '—' : minecraft.players + ' / ' + (minecraft.maxPlayers ?? '—');
  $('minecraft-process').textContent = minecraft.process ?
    'Processo Java candidato: ' + minecraft.process.jar + ' · PID ' + minecraft.process.pid + '. O vínculo com a porta não foi verificado.' :
    'Processo Java não identificado; o estado da porta é medido separadamente.';
}

function renderInsights() {
  const { issues, complete, anyFresh } = getInsights(latestStatus, latestHealth);
  $('alerts-summary').textContent = issues.length ? issues.length + (issues.length === 1 ? ' sinal de atenção' : ' sinais de atenção') :
    complete ? 'Tudo em ordem nas leituras recentes' : anyFresh ? 'Leituras parciais' : 'Aguardando leituras';
  if (!issues.length) {
    $('alerts-list').replaceChildren(el('p', complete ? 'Nenhum alerta nas leituras recentes.' :
      'Aguardando dados recentes do dispositivo e do watchdog.', 'empty'));
    return;
  }
  $('alerts-list').replaceChildren(...issues.map(issue => {
    const row = el('a', '', 'alert-row ' + issue.level);
    row.href = issue.href;
    const copy = el('span', '');
    copy.append(el('strong', issue.title), el('small', issue.detail));
    row.append(el('span', issue.level === 'critical' ? '!' : '●', 'alert-mark'), copy, el('span', '↗', 'alert-arrow'));
    return row;
  }));
}
