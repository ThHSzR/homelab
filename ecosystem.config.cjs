const path = require('node:path');
const os = require('node:os');
module.exports = { apps: [{ name: 'homelab-status', script: 'server.js', cwd: __dirname,
  interpreter: process.execPath,
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 2000,
  max_memory_restart: '180M', time: true,
  out_file: path.join(os.homedir(), 'services/logs/homelab-status-out.log'),
  error_file: path.join(os.homedir(), 'services/logs/homelab-status-error.log'),
  env: { NODE_ENV: 'production', PORT: '3000', HOST: '0.0.0.0',
    BOM_DIA_MANAGER: process.env.BOM_DIA_MANAGER || 'runit',
    CF_ACCESS_ISSUER: process.env.CF_ACCESS_ISSUER || '', CF_ACCESS_AUD: process.env.CF_ACCESS_AUD || '',
    CONTROL_ADMIN_EMAILS: process.env.CONTROL_ADMIN_EMAILS || '', CONTROL_ORIGIN: process.env.CONTROL_ORIGIN || '',
    MINECRAFT_CONTROL_ENABLED: process.env.MINECRAFT_CONTROL_ENABLED || '0',
    TAILSCALE_CONTROL_ENABLED: process.env.TAILSCALE_CONTROL_ENABLED || '0' }
}, { name: 'homelab-watchdog', script: 'watchdog.js', cwd: __dirname,
  interpreter: process.execPath, instances: 1, exec_mode: 'fork', autorestart: true,
  restart_delay: 5000, max_memory_restart: '100M', time: true,
  env: { NODE_ENV: 'production', PORT: '3000', BOM_DIA_MANAGER: process.env.BOM_DIA_MANAGER || 'runit', WATCHDOG_RECOVER_BOM_DIA: '0', MINECRAFT_PORT: '25565' }
}] };
