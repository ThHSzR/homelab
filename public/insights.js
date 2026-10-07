function getInsights(status, health) {
  const issues = [];
  const statusReady = status && !status.stale;
  const healthReady = health && !health.stale;
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
  }
  if (healthReady) {
    const minecraft = health.services?.minecraft;
    if (minecraft?.status === 'online' && Number.isFinite(minecraft.process?.memoryPercent) && minecraft.process.memoryPercent >= 35)
      issues.push({ level: 'warning', title: 'Minecraft usa muita RAM',
        detail: minecraft.process.memoryPercent + '% da memória do dispositivo no processo Java candidato.', href: '#minecraft' });
  }
  return { issues, complete: !!(statusReady && healthReady), anyFresh: !!(statusReady || healthReady) };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { getInsights };
else window.getInsights = getInsights;
