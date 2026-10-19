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
  const totalRam = data.system?.memory?.totalBytes || data.memory.totalBytes;
  const availableRam = data.system?.memory?.availableBytes ?? data.memory.freeBytes;
  const used = Math.max(0, totalRam - availableRam);
  $('memory').textContent = bytes(used);
  $('memory-detail').textContent = bytes(availableRam) + ' disponíveis de ' + bytes(totalRam);
  $('memory-bar').style.width = totalRam ? Math.min(100, Math.max(0, used / totalRam * 100)) + '%' : '0%';
  $('disk').textContent = data.disk ? data.disk.percent + '%' : 'Indisponível';
  $('disk-detail').textContent = data.disk ? bytes(data.disk.availableBytes) + ' livres de ' + bytes(data.disk.totalBytes) : 'Sem permissão para leitura';
  $('disk-bar').style.width = Math.min(100, Math.max(0, data.disk?.percent || 0)) + '%';
  $('battery').textContent = data.battery.available ? data.battery.percentage + '%' : 'Sem leitura';
  $('battery-detail').textContent = data.battery.available ? (data.battery.temperature ?? '—') + ' °C · ' + ({ CHARGING: 'Carregando', DISCHARGING: 'Em uso', FULL: 'Carga completa', NOT_CHARGING: 'Sem carregar' }[data.battery.status] || data.battery.status || '') : data.battery.reason;
  $('power-summary').textContent = data.power?.available ? data.power.connection === 'unplugged' ?
    'Sem carregador desde ' + new Date(data.power.changedAt).toLocaleString('pt-BR') :
    'Carregador conectado · ' + (data.power.history?.length || 0) + ' mudança(s) registradas' :
    'Estado do carregador indisponível';
  const powerHistory = data.power?.history?.slice(-5).reverse() || [];
  $('power-history').replaceChildren(...(powerHistory.length ? powerHistory.map(event => {
    const detail = event.to === 'plugged' ? 'Energia voltou' : 'Energia caiu';
    const elapsed = event.outageMs == null ? '' : ' · queda de ' + duration(event.outageMs / 1000);
    return el('li', new Date(event.at).toLocaleString('pt-BR') + ' · ' + detail + elapsed);
  }) : [el('li', 'Nenhuma mudança registrada ainda.') ]));
  $('tail-ip').textContent = data.tailscale.ip || 'Não detectado';
  $('tail-status').textContent = data.stale ? 'Leitura desatualizada' : data.tailscale.detected == null ? 'Interfaces Android indisponíveis' : data.tailscale.detected ? 'Interface ' + data.tailscale.interface + ' ativa · alcance remoto não verificado' : 'Nenhuma interface da rede privada detectada';
  const boot = data.persistence.lastRun;
  $('boot-state').textContent = data.persistence.bootScriptRanThisBoot ? 'Script executado neste boot' : 'Teste de reboot pendente';
  $('boot-detail').textContent = boot ? 'Última execução: ' + new Date(boot.timestamp).toLocaleString('pt-BR') + (boot.source === 'manual-test' ? ' · teste manual' : '') : 'Aguardando primeira execução do script';
  renderSystem(data.system, !!data.stale);
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
update(); modules(); setInterval(() => { if (document.visibilityState === 'visible') update(); }, 15000);
renderDiagnostics();
window.addEventListener('online', () => { recordDiagnostic('browser', { result: 'ONLINE', elapsedMs: 0 }); update(); health(); });
window.addEventListener('offline', () => recordDiagnostic('browser', { result: 'OFFLINE', elapsedMs: 0 }));
window.addEventListener('focus', () => { recordDiagnostic('browser', { result: 'FOCUS', elapsedMs: 0 }); update(); health(); });
document.addEventListener('visibilitychange', () => {
  recordDiagnostic('browser', { result: document.visibilityState.toUpperCase(), elapsedMs: 0 });
  if (document.visibilityState === 'visible') { update(); health(); }
});

const healthNames = { dashboard: 'Dashboard · :3000', ssh: 'SSH · :8022', 'bom-dia': 'Bom Dia',
  external: 'Conectividade externa', minecraft: 'Minecraft · Java', playit: 'Playit · processo',
  'cloudflare-tunnel': 'Cloudflare Tunnel · processo', 'public-dashboard': 'Dashboard · acesso público',
  'minecraft-public': 'Minecraft · acesso publicado' };
function renderHealthCards(data) {
  // Preserve card and switch identity on every watchdog refresh.
  for (const [id, name] of Object.entries(healthNames)) {
    const s = data?.services?.[id];
    let card = $('health-card-' + id);
    if (!card) {
      card = el('article', '', 'panel'); card.id = 'health-card-' + id;
      card.append(el('strong', name));
      const reading = el('div', '', 'service-reading'); reading.id = 'reading-' + id;
      card.append(reading); $('health-list').append(card);
    }
    const reading = $('reading-' + id);
    const stale = !data || data.stale || !s;
    reading.replaceChildren(el('p', stale ? 'Sem leitura recente' : labels[s.status] || s.status, 'status ' + (stale ? 'unknown' : s.status)),
      el('p', s ? s.latencyMs + ' ms · duração da verificação' : 'Monitor indisponível'),
      ...(s?.manager ? [el('small', 'Gerenciado por ' + s.manager)] : []),
      ...(s?.detail ? [el('small', s.detail)] : []),
      ...(s?.expected ? [el('small', 'Estado desejado: ' + (s.expected === 'online' ? 'ligado' : 'desligado'))] : []),
      el('small', 'Última mudança: ' + (s?.changedAt ? new Date(s.changedAt).toLocaleString('pt-BR') : '—')),
      el('small', 'Visto online: ' + (s?.lastSeen ? new Date(s.lastSeen).toLocaleString('pt-BR') : 'Ainda não')));
    const recent = data?.history?.slice(-20) || [];
    const strip = el('div', '', 'health-history');
    recent.forEach(row => {
      const status = row.services?.[id]?.status || 'unknown';
      const dot = el('span', '', 'health-dot ' + status);
      dot.title = new Date(row.timestamp).toLocaleString('pt-BR') + ' · ' + (labels[status] || status); strip.append(dot);
    });
    strip.setAttribute('aria-label', 'Últimas ' + recent.length + ' verificações; verde indica online');
    reading.append(strip);
  }
  const userspace = data?.services?.['tailscale-userspace'];
  $('tail-termux-ip').textContent = !data?.stale && userspace?.ip ? userspace.ip : '—';
  $('tail-termux-status').textContent = !data || data.stale ? 'Sem leitura recente do daemon' : userspace?.detail || 'Instância userspace não confirmada';
  for (const [id, parent] of [['tailscale', 'tailscale-android'], ['tailscale-userspace', 'tailscale-termux']]) {
    const history = $(parent).querySelector('.health-history');
    const recent = data?.history?.slice(-20) || [];
    history.replaceChildren(...recent.map(row => {
      const status = row.services?.[id]?.status || 'unknown';
      const dot = el('span', '', 'health-dot ' + status);
      dot.title = new Date(row.timestamp).toLocaleString('pt-BR') + ' · ' + (labels[status] || status);
      return dot;
    }));
    history.setAttribute('aria-label', 'Últimas ' + recent.length + ' verificações de ' + (id === 'tailscale' ? 'Tailscale Android' : 'Tailscale Termux'));
  }
}
function renderUptime(data) {
  const days = data?.uptime?.days || {};
  const ids = ['dashboard', 'ssh', 'bom-dia', 'minecraft', 'playit', 'cloudflare-tunnel'];
  const today = new Date();
  const keys = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index)).toISOString().slice(0, 10));
  const periodMs = Date.now() - Date.parse(keys.at(-1) + 'T00:00:00.000Z');
  $('uptime-list').replaceChildren(...ids.map(id => {
    const totals = keys.reduce((sum, day) => {
      const row = days[day]?.[id];
      for (const kind of ['online', 'offline', 'unknown']) sum[kind] += row?.[kind] || 0;
      return sum;
    }, { online: 0, offline: 0, unknown: 0 });
    const observed = totals.online + totals.offline;
    const item = el('div', '', 'uptime-item');
    item.append(el('strong', healthNames[id] || id),
      el('span', observed ? (100 * totals.online / observed).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% online no tempo observado' : 'Sem histórico'),
      el('small', observed ? Math.round(observed / 3600000) + ' h observadas · cobertura ' +
        Math.round(100 * observed / periodMs) + '% · ' + Math.round(totals.unknown / 60000) +
        ' min sem leitura' : 'Aguardando medições'));
    return item;
  }));
}
async function health() {
  try {
    const response = await diagnosticFetch('/api/health', 'health');
    if (!response.ok) throw new Error();
    const data = await response.json();
    $('health-summary').textContent = data.stale ? 'Monitor sem leitura recente' : 'Última leitura: ' + new Date(data.timestamp).toLocaleTimeString('pt-BR');
    renderHealthCards(data);
    renderUptime(data);
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
    renderHealthCards(null);
    renderUptime(null);
    latestHealth = { stale: true };
    renderInsights();
    renderMinecraft(null, true);
  }
}
$('refresh').addEventListener('click', health);
health(); setInterval(() => { if (document.visibilityState === 'visible') health(); }, 15000);

function renderMinecraft(minecraft, stale) {
  if (!minecraft || stale) {
    $('minecraft-updated').textContent = 'Sem leitura recente';
    $('minecraft-state').textContent = 'Aguardando monitor';
    $('minecraft-detail').textContent = 'Dados indisponíveis ou desatualizados';
    $('minecraft-memory').textContent = '—';
    $('minecraft-cpu').textContent = '—';
    $('minecraft-cpu-reason').textContent = 'Sem leitura recente do monitor';
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
  $('minecraft-cpu').textContent = minecraft.process?.cpuPercent == null ? '—' : minecraft.process.cpuPercent.toLocaleString('pt-BR') + '%';
  $('minecraft-cpu-reason').textContent = minecraft.process?.cpuPercent == null ? minecraft.process?.cpuReason || minecraft.cpuReason || 'Medição indisponível; atualize o watchdog.' :
    minecraft.process.cpuMethod === 'pm2-monitor' ? 'Leitura do PM2 · processo minecraft registrado' :
      '100% equivale a um núcleo · intervalo ' + Math.round(minecraft.process.sampleIntervalMs / 1000) + ' s';
  $('minecraft-players').textContent = minecraft.players == null ? '—' : minecraft.players + ' / ' + (minecraft.maxPlayers ?? '—');
  $('minecraft-process').textContent = minecraft.process ?
    (minecraft.process.cpuMethod === 'pm2-monitor' ? 'Processo PM2: ' : 'Processo Java candidato: ') + minecraft.process.jar + ' · PID ' + minecraft.process.pid + '. O vínculo com a porta não foi verificado.' :
    'Processo Java não identificado; o estado da porta é medido separadamente.';
}

function renderInsights() {
  const { issues, complete, anyFresh } = getInsights(latestStatus, latestHealth);
  const allReady = complete && window.homelabNetworkFresh === true;
  $('alerts-summary').textContent = issues.length ? issues.length + (issues.length === 1 ? ' sinal de atenção' : ' sinais de atenção') :
    allReady ? 'Tudo em ordem nas leituras recentes' : anyFresh ? 'Leituras parciais' : 'Aguardando leituras';
  if (!issues.length) {
    $('alerts-list').replaceChildren(el('p', allReady ? 'Nenhum alerta nas leituras recentes.' :
      'Aguardando dados recentes do dispositivo, watchdog e rede.', 'empty'));
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
window.addEventListener('homelab:network', renderInsights);


// Controls are children of the existing cards, never a second service grid.
const controlCards = new Map();
let controlRevision = 0;
const controlLabels = { online: 'Ligado', offline: 'Desligado', starting: 'Ligando…', stopping: 'Desligando…', unknown: 'Estado desconhecido' };
const tailscaleCard = $('tailscale-android').closest('.panel');
tailscaleCard.id = 'health-card-tailscale';
for (const id of ['tailscale-android', 'tailscale-termux']) $(id).append(el('div', '', 'health-history'));
renderHealthCards(null);
$('health-list').append(tailscaleCard);
for (const [id, name, parent] of [['bom-dia', 'Bom Dia', 'health-card-bom-dia'], ['minecraft', 'Minecraft', 'health-card-minecraft'], ['tailscale-userspace', 'Tailscale Termux', 'tailscale-termux']]) {
  const card = el('div', '', 'service-control');
  const button = el('button', '', 'service-toggle');
  button.type = 'button'; button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', 'Ligar ou desligar ' + name);
  button.setAttribute('aria-checked', 'false'); button.disabled = true;
  button.append(el('span', '', 'toggle-thumb'));
  const state = el('p', 'Consultando…'); state.setAttribute('role', 'status');
  const error = el('p', '', 'control-error'); error.setAttribute('role', 'alert');
  const heading = el('div', '', 'service-card-heading');
  const title = $(parent).querySelector(id === 'tailscale-userspace' ? 'h3' : 'strong');
  heading.append(title, button);
  $(parent).prepend(heading);
  card.append(state, error);
  $(parent).append(card);
  const entry = { button, state, error, busy: false, current: 'unknown', confirmed: null };
  controlCards.set(id, entry);
  button.addEventListener('click', async () => {
    if (entry.busy || button.disabled || [...controlCards.values()].some(e => e.busy)) return;
    const action = entry.current === 'online' ? 'stop' : 'start';
    if (id === 'minecraft' && action === 'stop' && !window.confirm('Desligar o Minecraft? O mundo será salvo e os jogadores serão desconectados.')) return;
    if (id === 'tailscale-userspace' && action === 'stop' && !window.confirm('Desligar o Tailscale do Termux? Conexões SSH por esta instância serão interrompidas.')) return;
    controlRevision++;
    entry.busy = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
    state.textContent = action === 'start' ? 'Ligando…' : 'Desligando…'; error.textContent = '';
    try {
      const response = await fetch('/api/services/' + id, { method: 'POST', headers: {
        'Content-Type': 'application/json'
      }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(65000), redirect: 'error' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Falha ao controlar o serviço.');
    } catch (failure) { error.textContent = failure.message || 'Falha de conexão; confirme o estado antes de tentar novamente.'; }
    finally { entry.busy = false; button.setAttribute('aria-busy', 'false'); await updateControls(); }
  });
}
let controlsReading = false;
async function updateControls() {
  if (controlsReading) return;
  controlsReading = true;
  const revision = controlRevision;
  try {
    const response = await fetch('/api/services', { cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Controle indisponível.');
    // A response sampled before a command cannot overwrite its result.
    if (revision !== controlRevision) return;
    for (const [id, entry] of controlCards) {
      if (entry.busy) continue;
      const service = data[id]; entry.current = service?.state || 'unknown';
      if (['online', 'offline'].includes(entry.current)) entry.confirmed = entry.current;
      entry.button.setAttribute('aria-checked', String(entry.current === 'online' ||
        ['starting', 'stopping'].includes(entry.current) && (entry.confirmed === 'online' || entry.confirmed == null && entry.current === 'stopping')));
      entry.button.setAttribute('aria-busy', String(['starting', 'stopping'].includes(entry.current)));
      entry.button.disabled = !service?.available || !['online', 'offline'].includes(entry.current);
      entry.state.textContent = (controlLabels[entry.current] || controlLabels.unknown) + (service?.reason ? ' · ' + service.reason : '');
    }
  } catch (failure) {
    if (revision !== controlRevision) return;
    for (const entry of controlCards.values()) {
      if (entry.busy) continue;
      entry.current = 'unknown'; entry.button.disabled = true;
      entry.button.setAttribute('aria-checked', 'false');
      entry.button.setAttribute('aria-busy', 'false');
      entry.state.textContent = 'Estado desconhecido · ' + failure.message;
    }
  } finally { controlsReading = false; }
}
let lastControlRead = 0;
async function scheduledControls() {
  if (document.visibilityState !== 'visible') return;
  const active = [...controlCards.values()].some(entry => entry.busy || ['starting', 'stopping'].includes(entry.current));
  if (!active && Date.now() - lastControlRead < 15000) return;
  lastControlRead = Date.now();
  await updateControls();
}
lastControlRead = Date.now(); updateControls(); setInterval(scheduledControls, 5000);
function selectNavigation() {
  const current = location.hash || '#overview';
  document.querySelectorAll('nav a[href^="#"]').forEach(link => {
    const selected = link.getAttribute('href') === current;
    link.classList.toggle('selected', selected);
    if (selected) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', selectNavigation);
selectNavigation();

function metricBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Indisponível';
  const units = ['B','KB','MB','GB','TB'];
  let n = value, unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return n.toLocaleString('pt-BR', { maximumFractionDigits: n >= 10 ? 1 : 2 }) + ' ' + units[unit];
}
function systemRow(label, value) {
  const line = el('div', '', 'system-line');
  line.append(el('span', label), el('strong', String(value ?? 'Indisponível')));
  return line;
}
function systemRows(target, values) {
  const node = $(target);
  if (!node) return;
  node.classList.add('system-list');
  node.replaceChildren(...values.map(([label, value]) => systemRow(label,value)));
}
function renderSystem(system, stale) {
  const updated = $('system-updated');
  const highlights = $('system-highlights');
  if (!updated || !highlights) return;
  if (!system) {
    updated.textContent = 'Aguardando telemetria · Termux pode limitar leituras';
    highlights.replaceChildren(...['CPU','SWAP','WI-FI'].map(name => {
      const tile = el('article','','telemetry-tile');
      tile.append(el('small', name), el('strong','Sem leitura'));
      return tile;
    }));
    for (const id of ['system-cores','system-memory','system-thermal','system-pressure','system-device','system-ifaces'])
      if ($(id)) $(id).textContent = 'Sem leitura disponível neste momento.';
    return;
  }
  updated.textContent = (stale ? 'Leitura desatualizada · ' : 'Atualizado às ') +
    new Date(system.timestamp).toLocaleTimeString('pt-BR');
  const cpu = system.cpu || {}, mem = system.memory || {}, wifi = system.wifi || {};
  const percent = n => Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : 'Aguardando 2ª amostra';
  const tiles = [
    ['CPU DO SISTEMA', percent(cpu.percent), (cpu.count || 0) + ' núcleo(s) visíveis'],
    ['SWAP', mem.swapTotalBytes == null ? 'Indisponível' : metricBytes(mem.swapUsedBytes),
      mem.swapTotalBytes == null ? 'Leitura bloqueada pelo Android' : 'de ' + metricBytes(mem.swapTotalBytes)],
    ['WI-FI', wifi.available ? (wifi.ssid || 'Conectado') : 'Sem leitura',
      wifi.available ? (wifi.rssi == null ? 'Sinal não informado' : wifi.rssi + ' dBm') : (wifi.reason || 'Termux:API indisponível')]
  ];
  highlights.replaceChildren(...tiles.map(([label, value, detail]) => {
    const card = el('article','','telemetry-tile');
    card.append(el('small',label),el('strong',value),el('p',detail,'telemetry-sub'));
    return card;
  }));
  const coreList = $('system-cores');
  if (coreList) {
    const cores = cpu.cores || [];
    coreList.replaceChildren(...(cores.length ? cores.map(core => {
      const row = el('div','','core-row');
      const track = el('div','','core-track');
      const fill = el('i', '');
      fill.style.width = (core.percent ?? 0) + '%';
      track.append(fill);
      row.append(el('span',core.core),track,el('strong',
        (core.percent == null ? '—' : percent(core.percent)) +
        (core.frequencyMhz == null ? '' : ' · ' + core.frequencyMhz + ' MHz')));
      return row;
    }) : [el('p','O Android não expôs os contadores /proc/stat.','empty')]));
  }
  systemRows('system-memory', [
    ['RAM total', metricBytes(mem.totalBytes)], ['RAM disponível', metricBytes(mem.availableBytes)],
    ['Cache', metricBytes(mem.cachedBytes)], ['Buffers', metricBytes(mem.buffersBytes)],
    ['RAM ativa', metricBytes(mem.activeBytes)], ['RAM inativa', metricBytes(mem.inactiveBytes)],
    ['Slab do kernel', metricBytes(mem.slabBytes)], ['Páginas sujas', metricBytes(mem.dirtyBytes)],
    ['Swap utilizado', metricBytes(mem.swapUsedBytes)], ['Swap total', metricBytes(mem.swapTotalBytes)]
  ]);
  const sensors = system.thermal?.sensors || [];
  systemRows('system-thermal', sensors.length ? sensors.map(item => [
    item.type + ' · ' + item.sensor, item.celsius.toLocaleString('pt-BR') + ' °C'
  ]) : [['Sensores','Indisponíveis neste Android sem permissões extras']]);
  const pressure = system.pressure || {};
  const psi = name => pressure[name]?.some?.avg10 == null ? 'Não disponível' :
    percent(pressure[name].some.avg10) + ' de espera (10 s)' +
    (pressure[name].full?.avg10 == null ? '' : ' · total ' + percent(pressure[name].full.avg10));
  systemRows('system-pressure', [
    ['CPU', psi('cpu')], ['Memória',psi('memory')], ['Disco / I/O', psi('io')]
  ]);
  const d = system.device || {};
  systemRows('system-device', [
    ['Fabricante',d.manufacturer], ['Modelo',d.model],
    ['Versão Android',d.android], ['API Android',d.sdk],
    ['Codinome',d.device], ['Arquitetura',d.architecture],
    ['Kernel',d.kernel], ['Node.js',d.node],
    ['Hostname',d.hostname], ['Processos visíveis',d.visibleProcesses]
  ]);
  const interfaces = system.interfaces || [];
  const rate = v => v == null ? 'Aguardando 2ª amostra' : metricBytes(v) + '/s';
  systemRows('system-ifaces', interfaces.length ? interfaces.flatMap(item => [
    [item.name + ' · RX',rate(item.rxPerSecond) + ' · ' + metricBytes(item.rxBytes)],
    [item.name + ' · TX',rate(item.txPerSecond) + ' · ' + metricBytes(item.txBytes)],
    [item.name + ' · erros/descarte',item.rxErrors + '/' + item.rxDrops + ' RX · ' +
      item.txErrors + '/' + item.txDrops + ' TX']
  ]) : [['Interfaces','Sem leitura disponível de /proc/net/dev']]);
}

// Opening a navigation item in a collapsed diagnostic group reveals the actual section.
function revealDashboardSection() {
  const id = location.hash?.slice(1);
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  if (target.tagName === 'DETAILS') target.open = true;
  for (let parent = target.parentElement; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
}
window.addEventListener('hashchange', revealDashboardSection);
revealDashboardSection();
