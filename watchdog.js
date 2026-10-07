const { createMonitor, INTERVAL } = require('./lib/watchdog');
const monitor = createMonitor();
let stopping = false;
let timer;
async function run() {
  try { await monitor.tick(); } catch (error) { console.error('Watchdog:', error.message); }
  if (!stopping) timer = setTimeout(run, INTERVAL);
}
function stop() { stopping = true; clearTimeout(timer); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
run();
