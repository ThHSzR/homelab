const path = require('node:path');
const os = require('node:os');
module.exports = { apps: [{ name: 'homelab-status', script: 'server.js', cwd: __dirname,
  interpreter: process.execPath,
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 2000,
  max_memory_restart: '180M', time: true,
  out_file: path.join(os.homedir(), 'services/logs/homelab-status-out.log'),
  error_file: path.join(os.homedir(), 'services/logs/homelab-status-error.log'),
  env: { NODE_ENV: 'production', PORT: '3000', HOST: '0.0.0.0' }
}] };
