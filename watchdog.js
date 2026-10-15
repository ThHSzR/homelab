const { createMonitor, INTERVAL } = require('./lib/watchdog');
const { createNetworkMonitor, INTERVAL: NETWORK_INTERVAL } = require('./lib/network-monitor');
const monitor = createMonitor();
const network = createNetworkMonitor();
let stopping = false;
let timer;
let networkDue = 0;
async function run() {
  const jobs = [monitor.tick().catch(error => console.error('Watchdog:', error.message))];
  if (Date.now() >= networkDue) {
    networkDue = Date.now() + NETWORK_INTERVAL;
    jobs.push(network.tick().catch(error => console.error('Rede:', error.message)));
  }
  await Promise.all(jobs);
  if (!stopping) timer = setTimeout(run, INTERVAL);
}
function stop() { stopping = true; clearTimeout(timer); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
run();
