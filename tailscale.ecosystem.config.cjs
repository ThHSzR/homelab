const path = require('node:path');
const os = require('node:os');
// Apply only after installing deploy/tailscale-supervisor.cjs and desired.json.
module.exports = { apps: [{ name: 'tailscale-userspace',
  script: path.join(os.homedir(), 'services/tailscale-userspace/supervisor.cjs'),
  cwd: os.homedir(), interpreter: process.execPath, exec_mode: 'fork', instances: 1,
  autorestart: true, restart_delay: 10000, stop_exit_codes: [0], kill_timeout: 4000,
  watch: false, time: true
}] };
