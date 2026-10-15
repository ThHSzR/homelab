(() => {
  const $ = id => document.getElementById(id);
  const element = (tag, value = '', className = '') => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const stateText = { online: 'Online', offline: 'Sem resposta', unknown: 'Sem leitura', recent: 'Visto antes' };
  const time = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
  const size = value => value == null ? '—' : value >= 1073741824 ? (value / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' GB' :
    value >= 1048576 ? (value / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' :
      value >= 1024 ? (value / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' KB' : value + ' B';
  const rate = value => value == null ? 'Aguardando segunda amostra' : size(value) + '/s';
  function strip(target, history, key, unit, lossKey) {
    const values = (history || []).slice(-40);
    let output = target.nextElementSibling;
    if (!output?.classList.contains('chart-reading')) {
      output = element('output', '', 'chart-reading');
      target.after(output);
    }
    const maximum = Math.max(1, ...values.map(row => row[key] || 0));
    target.replaceChildren(...values.map(row => {
      const item = element('button', '', 'network-bar' + (lossKey && row[lossKey] > 0 ? ' lossy' : ''));
      item.type = 'button';
      const value = row[key];
      item.style.height = value == null ? '4px' : Math.max(5, Math.round(value / maximum * 52)) + 'px';
      item.title = time(row.timestamp) + ' · ' + (value == null ? 'sem leitura' : value.toLocaleString('pt-BR') + unit) +
        (lossKey && row[lossKey] != null ? ' · perda ' + row[lossKey] + '%' : '');
      item.setAttribute('aria-label', item.title);
      item.addEventListener('click', () => { output.textContent = item.title; });
      return item;
    }));
  }
  function render(data) {
    $('network-updated').textContent = data.stale ? 'Leitura desatualizada' : 'Atualizado ' + time(data.timestamp);
    const boxes = [
      ['Gateway', data.connectivity?.gateway, data.lan?.gateway || 'Gateway não identificado'],
      ['Internet · ping', data.connectivity?.internet, 'Destino fixo 1.1.1.1'],
      ['DNS', data.connectivity?.dns, 'Resolução de nome externo'],
      ['Web · HTTPS', data.connectivity?.web, 'Verificação HTTP externa']
    ];
    $('network-overview').replaceChildren(...boxes.map(([label, result, detail]) => {
      const card = element('article', '', 'panel network-status-card');
      const status = data.stale ? 'unknown' : result?.status || 'unknown';
      card.append(element('small', label, 'eyebrow'), element('strong', stateText[status] || stateText.unknown, 'network-state ' + status),
        element('p', detail), element('small', result?.latencyMs == null ? 'Latência indisponível' :
          result.latencyMs.toLocaleString('pt-BR') + ' ms' + (result.lossPercent == null ? '' : ' · perda ' + result.lossPercent + '%')));
      return card;
    }));
    strip($('gateway-history'), data.history, 'gatewayLatencyMs', ' ms', 'gatewayLossPercent');
    strip($('network-history'), data.history, 'internetLatencyMs', ' ms', 'internetLossPercent');
    strip($('dns-history'), data.history, 'dnsLatencyMs', ' ms');
    $('network-history-note').textContent = 'Até 40 amostras recentes · laranja indica perda de pacotes. Ping sem resposta e falha DNS/HTTPS são apresentados separadamente.';
    $('devices-summary').textContent = (data.devices?.length || 0) + ' dispositivo(s) visto(s) nos últimos 30 min';
    $('devices-note').textContent = data.lan ? data.lan.interface + ' · ' + data.lan.ip + '/' + data.lan.prefix +
      (data.lan.gateway ? ' · gateway ' + data.lan.gateway : '') + ' · ' +
      (data.scan?.note || 'Até ' + data.scan?.checkedThisRound + ' endereços por rodada; hosts que bloqueiam ping podem não aparecer.') :
      'Wi-Fi privado não identificado; descoberta pausada.';
    const rows = (data.devices || []).map(device => {
      const row = element('tr');
      const status = data.stale ? 'unknown' : device.status;
      for (const value of [stateText[status] || stateText.unknown, device.ip, device.hostname || '—', device.mac || '—',
        device.vendor || '—', time(device.lastSeen)]) row.append(element('td', value));
      row.firstChild.className = 'network-state ' + status;
      return row;
    });
    $('devices-list').replaceChildren(...(rows.length ? rows : [(() => {
      const row = element('tr'), cell = element('td', 'Nenhum host respondeu ainda.'); cell.colSpan = 6; row.append(cell); return row;
    })()]));
    $('ports-list').replaceChildren(...(data.ports || []).map(port => {
      const card = element('article', '', 'panel port-card');
      const status = data.stale ? 'unknown' : port.status;
      card.append(element('strong', port.label), element('span', stateText[status] || stateText.unknown, 'network-state ' + status),
        element('small', port.host + ':' + port.port + (port.httpStatus ? ' · HTTP ' + port.httpStatus : '')),
        element('small', port.latencyMs == null ? 'Sem latência confirmada' : port.latencyMs + ' ms'));
      return card;
    }));
    const lanTraffic = data.traffic?.find(item => item.interface === data.lan?.interface);
    $('traffic-updated').textContent = lanTraffic ? 'Interface principal: ' + lanTraffic.interface : 'Contadores indisponíveis';
    $('traffic-list').replaceChildren(...(data.traffic || []).map(item => {
      const card = element('article', '', 'panel traffic-card');
      card.append(element('small', item.kind + ' · ' + item.interface, 'eyebrow'),
        element('strong', '↓ ' + rate(item.rxBytesPerSec) + '  ↑ ' + rate(item.txBytesPerSec)),
        element('p', 'Desde o início da interface: ↓ ' + size(item.rxBytes) + ' · ↑ ' + size(item.txBytes)));
      return card;
    }));
    if (!data.traffic?.length) $('traffic-list').replaceChildren(element('p', 'Contadores de rede indisponíveis no Android.', 'empty'));
    strip($('traffic-history'), data.history, 'rxBytesPerSec', ' B/s');
    strip($('traffic-sent-history'), data.history, 'txBytesPerSec', ' B/s');
    $('traffic-note').textContent = data.trafficNote || 'Tráfego total por interface. Minecraft e túneis não são medidos separadamente.';
  }
  let reading = false;
  async function updateNetwork() {
    if (reading) return;
    reading = true;
    try {
      const response = await fetch('/api/network', { cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error(response.status === 403 ? 'abra pelo hostname protegido do Cloudflare Access' : 'HTTP ' + response.status);
      const data = await response.json();
      render(data);
      window.homelabNetworkFresh = !data.stale && Date.now() - Date.parse(data.timestamp) <= 180000;
      window.dispatchEvent(new Event('homelab:network'));
    } catch (error) {
      window.homelabNetworkFresh = false;
      window.dispatchEvent(new Event('homelab:network'));
      $('network-updated').textContent = 'Monitor de rede indisponível · ' + error.message;
      $('network-overview').querySelectorAll('.network-state').forEach(node => {
        node.textContent = 'Sem leitura'; node.className = 'network-state unknown';
      });
      $('ports-list').querySelectorAll('.network-state').forEach(node => {
        node.textContent = 'Sem leitura'; node.className = 'network-state unknown';
      });
    }
    finally { reading = false; }
  }
  const names = { all: 'Todos os serviços', 'homelab-status': 'Dashboard', 'homelab-watchdog': 'Watchdog', 'bom-dia': 'Bom Dia',
    minecraft: 'Minecraft', playit: 'Playit', 'cloudflare-tunnel': 'Cloudflare Tunnel', 'tailscale-userspace': 'Tailscale Termux' };
  let logRevision = 0;
  async function updateLogs() {
    const revision = ++logRevision;
    const service = $('log-service').value, stream = $('log-stream').value;
    if (!service) return;
    $('logs-content').textContent = 'Carregando…';
    try {
      const response = await fetch('/api/logs/' + encodeURIComponent(service) + '?stream=' + encodeURIComponent(stream),
        { cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
      if (revision !== logRevision) return;
      $('logs-content').textContent = data.text || 'Nenhuma linha neste canal.';
      $('logs-updated').textContent = names[service] + ' · ' + time(new Date().toISOString());
    } catch (error) { if (revision === logRevision) $('logs-content').textContent = 'Log indisponível: ' + error.message; }
  }
  async function loadSources() {
    try {
      const response = await fetch('/api/logs/sources', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(response.status === 403 ? 'Abra pelo hostname protegido do Cloudflare Access para ver logs.' : 'PM2 indisponível');
      const sources = await response.json();
      const all = element('option', names.all); all.value = 'all';
      $('log-service').replaceChildren(all, ...sources.filter(item => item.available).map(item => {
        const option = element('option', names[item.id] || item.id); option.value = item.id; return option;
      }));
      if (sources.every(item => !item.available)) throw new Error('Nenhum log disponível');
      await updateLogs();
    } catch (error) { $('logs-content').textContent = error.message; }
  }
  $('log-service').addEventListener('change', updateLogs);
  $('log-stream').addEventListener('change', updateLogs);
  $('logs-refresh').addEventListener('click', updateLogs);
  $('refresh').addEventListener('click', () => { updateNetwork(); updateLogs(); });
  updateNetwork(); loadSources();
  setInterval(() => { if (document.visibilityState === 'visible') updateNetwork(); }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible' && location.hash === '#logs') updateLogs(); }, 30000);
})();
