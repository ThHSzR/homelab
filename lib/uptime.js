const MAX_GAP_MS = 90_000;
const KEEP_DAYS = 30;
const KEEP_EVENTS = 500;

function dayKey(time) { return new Date(time).toISOString().slice(0, 10); }
function addSpan(days, id, status, start, end) {
  const kind = ['online', 'offline'].includes(status) ? status : 'unknown';
  while (start < end) {
    const nextDay = Date.parse(dayKey(start) + 'T00:00:00.000Z') + 86400000;
    const edge = Math.min(end, nextDay);
    const daily = days[dayKey(start)] ||= {};
    const service = daily[id] ||= { online: 0, offline: 0, unknown: 0 };
    service[kind] += edge - start;
    start = edge;
  }
}

function advanceUptime(previous = {}, before, after, previousTime, currentTime) {
  const result = { days: { ...(previous.days || {}) }, events: [...(previous.events || [])] };
  const last = Date.parse(previousTime), current = Date.parse(currentTime);
  if (!Number.isFinite(current)) return result;
  const cutoff = current - KEEP_DAYS * 86400000;
  for (const date of Object.keys(result.days)) if (Date.parse(date + 'T00:00:00.000Z') < cutoff - 86400000) delete result.days[date];
  if (Number.isFinite(last) && current > last) {
    for (const [id, old] of Object.entries(before || {})) {
      const observedUntil = Math.min(current, last + MAX_GAP_MS);
      addSpan(result.days, id, old.status, last, observedUntil);
      addSpan(result.days, id, 'unknown', observedUntil, current);
    }
  }
  for (const [id, service] of Object.entries(after || {})) {
    if (before?.[id]?.status !== service.status)
      result.events.push({ at: currentTime, id, from: before?.[id]?.status || 'unknown', to: service.status });
  }
  result.events = result.events.filter(event => Date.parse(event.at) >= cutoff).slice(-KEEP_EVENTS);
  return result;
}

module.exports = { advanceUptime };
