const $ = id => document.getElementById(id);
const bytes = n => n == null ? '—' : (n / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB';
const duration = n => { n = Math.max(0, Math.floor(n || 0)); const d = Math.floor(n / 86400), h = Math.floor(n % 86400 / 3600), m = Math.floor(n % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'm'; };
const labels = { online: 'Online', stopped: 'Parado', offline: 'Offline', unknown: 'Sem leitura', unmanaged: 'Sem PM2', errored: 'Erro', launching: 'Iniciando' };
function el(tag, text, cls) { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; }
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
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(response.status === 503 ? 'Coleta inicial em andamento' : 'Falha ao consultar a central');
    render(await response.json());
  } catch (error) {
    $('connection').className = 'banner warn';
    $('connection').textContent = (error.message === 'Coleta inicial em andamento' ? error.message : 'Central sem resposta · dados anteriores podem estar desatualizados') + '. Nova tentativa automática.';
  } finally { busy = false; }
}
async function modules() {
  try {
    const response = await fetch('/api/modules', { signal: AbortSignal.timeout(7000) });
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
