const path = require('node:path');
const os = require('node:os');
module.exports = { apps: [{ name: 'homelab-status', script: 'server.js', cwd: __dirname,
  interpreter: process.execPath,
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 2000,
  max_memory_restart: '180M', time: true,
  out_file: path.join(os.homedir(), 'services/logs/homelab-status-out.log'),
  error_file: path.join(os.homedir(), 'services/logs/homelab-status-error.log'),
  env: { NODE_ENV: 'production', PORT: '3000', HOST: '127.0.0.1',
    BOM_DIA_MANAGER: process.env.BOM_DIA_MANAGER || 'pm2',
    CONTROL_ORIGIN: process.env.CONTROL_ORIGIN || 'https://homelab.thsouza.eng.br',
    ACCESS_TEAM_DOMAIN: process.env.ACCESS_TEAM_DOMAIN || '',
    ACCESS_AUD: process.env.ACCESS_AUD || '',
    MINECRAFT_CONTROL_ENABLED: process.env.MINECRAFT_CONTROL_ENABLED || '0',
    TAILSCALE_CONTROL_ENABLED: process.env.TAILSCALE_CONTROL_ENABLED || '0' }
}, { name: 'homelab-watchdog', script: 'watchdog.js', cwd: __dirname,
  interpreter: process.execPath, instances: 1, exec_mode: 'fork', autorestart: true,
  restart_delay: 5000, max_memory_restart: '100M', time: true,
  env: { NODE_ENV: 'production', PORT: '3000', BOM_DIA_MANAGER: process.env.BOM_DIA_MANAGER || 'pm2', WATCHDOG_RECOVER_BOM_DIA: '0', MINECRAFT_PORT: '25565',
    CF_ACCESS_PROBE_ID: process.env.CF_ACCESS_PROBE_ID || '',
    CF_ACCESS_PROBE_SECRET: process.env.CF_ACCESS_PROBE_SECRET || '',
    PLAYIT_PUBLIC_HOST: process.env.PLAYIT_PUBLIC_HOST || '',
    PLAYIT_PUBLIC_PORT: process.env.PLAYIT_PUBLIC_PORT || '' }
}] };
