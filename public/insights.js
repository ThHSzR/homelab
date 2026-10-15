function fresh(data, maxAge, now) {
  return !!data && !data.stale && Number.isFinite(Date.parse(data.timestamp)) &&
    now - Date.parse(data.timestamp) >= -60000 && now - Date.parse(data.timestamp) <= maxAge;
}
function getInsights(status, health, now = Date.now()) {
  const issues = [];
  const statusReady = fresh(status, 35000, now);
  const healthReady = fresh(health, 90000, now);
  if (statusReady) {
    const battery = status.battery;
    if (battery?.available && Number.isFinite(battery.percentage) && battery.percentage <= 20 && battery.status === 'DISCHARGING')
      issues.push({ level: battery.percentage <= 10 ? 'critical' : 'warning', title: 'Bateria baixa',
        detail: battery.percentage + '% e descarregando. Conecte o carregador para manter os serviços ativos.', href: '#overview' });
    if (battery?.available && Number.isFinite(battery.temperature) && battery.temperature >= 42)
      issues.push({ level: 'critical', title: 'Bateria quente',
        detail: battery.temperature + ' °C. Confira ventilação e carga do aparelho.', href: '#overview' });
    if (Number.isFinite(status.disk?.percent) && status.disk.percent >= 85)
      issues.push({ level: status.disk.percent >= 95 ? 'critical' : 'warning', title: 'Armazenamento quase cheio',
        detail: status.disk.percent + '% usado. Revise logs e arquivos antes que os serviços fiquem sem espaço.', href: '#overview' });
    if (status.power?.available && status.power.connection === 'unplugged')
      issues.push({ level: 'warning', title: 'A30 sem alimentação',
        detail: 'Carregador desconectado desde ' + new Date(status.power.changedAt).toLocaleString('pt-BR') + '.', href: '#overview' });
  }
  if (healthReady) {
    const minecraft = health.services?.minecraft;
    if (minecraft?.status === 'online' && Number.isFinite(minecraft.process?.memoryPercent) && minecraft.process.memoryPercent >= 35)
      issues.push({ level: 'warning', title: 'Minecraft usa muita RAM',
        detail: minecraft.process.memoryPercent + '% da memória do dispositivo no processo Java candidato.', href: '#minecraft' });
    const names = { dashboard: 'Dashboard', ssh: 'SSH', external: 'Conectividade externa',
      'bom-dia': 'Bom Dia', minecraft: 'Minecraft', 'tailscale-userspace': 'Tailscale Termux',
      playit: 'Playit', 'cloudflare-tunnel': 'Cloudflare Tunnel', 'public-dashboard': 'Dashboard público',
      'minecraft-public': 'Minecraft publicado' };
    for (const [id, service] of Object.entries(health.services || {})) {
      if (service.expected !== 'online') continue;
      if (service.status === 'offline' && service.failures >= 3)
        issues.push({ level: ['dashboard', 'ssh', 'public-dashboard'].includes(id) ? 'critical' : 'warning',
          title: (names[id] || id) + ' indisponível',
          detail: 'Três ou mais verificações falharam. ' + (service.detail || 'Confira o serviço e seus logs.'),
          href: ['minecraft', 'minecraft-public'].includes(id) ? '#minecraft' : '#services' });
      if (service.status === 'unknown' && service.unknowns >= 3)
        issues.push({ level: 'warning', title: (names[id] || id) + ' sem confirmação',
          detail: service.detail || 'Não foi possível confirmar este serviço.', href: '#services' });
    }
  }
  if (health && !healthReady) issues.push({ level: 'warning', title: 'Monitor sem leitura recente',
    detail: 'O watchdog não confirmou uma leitura nos últimos 90 segundos.', href: '#services' });
  const essential = ['dashboard', 'ssh', 'external'];
  const coverage = healthReady && essential.every(id => ['online', 'offline'].includes(health.services?.[id]?.status));
  return { issues, complete: !!(statusReady && coverage), anyFresh: !!(statusReady || healthReady) };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { getInsights };
else window.getInsights = getInsights;
