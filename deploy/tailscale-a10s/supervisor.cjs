const { spawn } = require('node:child_process');
const http = require('node:http');
const base = process.env.HOME + '/services/tailscale-userspace';
let stopping = false;
let timer;
let failures = 0;
const started = Date.now();
const child = spawn('bash', [base + '/start.sh'], { detached: true, stdio: 'inherit' });
function stop(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    process.exit(code);
  }, 2500);
}
child.on('error', error => { console.error(error.message); stop(1); });
child.on('exit', (code, signal) => {
  if (!stopping) { console.error('Daemon exited:', code, signal); stop(1); }
});
function check() {
  if (stopping) return;
  let settled = false;
  const finish = ok => {
    if (settled || stopping) return;
    settled = true;
    failures = ok ? 0 : failures + 1;
    // Unavailable Internet or NeedsLogin are not reasons to restart.
    // Recover only when the local daemon API stops responding.
    if (failures >= 3 && Date.now() - started >= 60000) {
      console.error('Local API unresponsive for three checks; restarting isolated daemon');
      stop(1);
    } else timer = setTimeout(check, 20000);
  };
  const request = http.get({ socketPath: base + '/state/tailscaled.sock', path: '/localapi/v0/status?peers=false', headers: { Host: 'local-tailscaled.sock' } }, response => {
    response.resume();
    response.on('end', () => finish(response.statusCode === 200));
    response.on('error', () => finish(false));
  });
  const deadline = setTimeout(() => { request.destroy(); finish(false); }, 5000);
  request.on('close', () => clearTimeout(deadline));
  request.on('error', () => finish(false));
}
timer = setTimeout(check, 15000);
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
