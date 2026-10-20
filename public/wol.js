(() => {
  const $ = id => document.getElementById(id);
  const wakeButton = $('wol-wake'), refreshButton = $('wol-refresh');
  const stateNode = $('wol-state'), detailNode = $('wol-detail'), networkNode = $('wol-network');
  const resultNode = $('wol-result'), updatedNode = $('wol-updated');
  let busy = false, revision = 0, ready = false, currentState = 'unknown';

  const stateLabels = {
    online: 'Ligado · ping confirmado',
    unverified: 'Não foi possível confirmar',
    unknown: 'Estado desconhecido'
  };

  function setButtonState() {
    wakeButton.disabled = busy || !ready || currentState === 'online';
    wakeButton.setAttribute('aria-busy', String(busy));
    wakeButton.textContent = busy ? 'Enviando pacote…' : '⏻ Ligar desktop';
  }

  async function refreshDesktop() {
    if (busy) return;
    const requestRevision = ++revision;
    try {
      const response = await fetch('/api/devices/desktop/status', {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (requestRevision !== revision) return;
      ready = data.ready === true;
      currentState = data.state || 'unknown';
      stateNode.textContent = ready ? (stateLabels[currentState] || stateLabels.unknown) : 'Configuração pendente';
      stateNode.className = 'wol-state ' + (currentState === 'online' && ready ? 'online' : 'unknown');
      detailNode.textContent = !ready ? (data.reason || 'Configure o desktop no PM2.') :
        data.state === 'online' ? 'Computador respondeu à verificação ICMP.' :
          data.probeConfigured ? 'O PC pode estar desligado ou bloqueando ping. Não é possível confirmar.' :
            'WOL disponível. Defina WOL_DESKTOP_IP para consultar o estado por ping.';
      networkNode.textContent = data.localIp && data.broadcast ?
        data.interface + ' · ' + data.localIp + ' → ' + data.broadcast :
        'Rede local não identificada.';
      updatedNode.textContent = 'Verificado às ' + new Date().toLocaleTimeString('pt-BR');
    } catch (error) {
      if (requestRevision !== revision) return;
      ready = false;
      currentState = 'unknown';
      stateNode.className = 'wol-state unknown';
      stateNode.textContent = 'Consulta indisponível';
      detailNode.textContent = 'Não foi possível consultar a API de Wake-on-LAN.';
      updatedNode.textContent = 'Sem leitura recente';
    } finally {
      if (requestRevision === revision) setButtonState();
    }
  }

  wakeButton.addEventListener('click', async () => {
    if (busy || !ready || currentState === 'online') return;
    busy = true; revision++;
    setButtonState();
    resultNode.textContent = 'Solicitando envio do Magic Packet…';
    resultNode.className = 'wol-result';
    try {
      const response = await fetch('/api/devices/desktop/wake', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
      if (!data.accepted) throw new Error('O servidor não confirmou o envio.');
      resultNode.textContent = 'Pacote enviado. Aguardando confirmação de inicialização.';
      resultNode.className = 'wol-result success';
      updatedNode.textContent = 'WOL solicitado às ' + new Date().toLocaleTimeString('pt-BR');
      setTimeout(refreshDesktop, 5000);
      setTimeout(refreshDesktop, 15000);
    } catch (error) {
      resultNode.textContent = 'Falha no WOL: ' + (error.message || 'Erro desconhecido.');
      resultNode.className = 'wol-result error';
    } finally {
      busy = false;
      await refreshDesktop();
    }
  });

  refreshButton.addEventListener('click', refreshDesktop);
  $('refresh').addEventListener('click', refreshDesktop);
  window.addEventListener('focus', refreshDesktop);
  refreshDesktop();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshDesktop();
  }, 30000);
})();
