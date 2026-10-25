const path = require('path');
module.exports = {apps: [{
  name: 'tailscale-userspace',
  script: path.join(__dirname, 'supervisor.cjs'),
  cwd: __dirname,
  autorestart: true, min_uptime: 0, restart_delay: 15000,
  kill_timeout: 5000,
  out_file: path.join(__dirname, 'logs/out.log'),
  error_file: path.join(__dirname, 'logs/error.log'),
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
}]};
