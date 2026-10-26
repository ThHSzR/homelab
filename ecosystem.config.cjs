const path = require('node:path');
const os = require('node:os');
module.exports = { apps: [{ name: 'homelab-status', script: 'server.js', cwd: __dirname,
  interpreter: process.execPath,
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 2000,
  max_memory_restart: '180M', time: true,
  out_file: path.join(os.homedir(), 'services/logs/homelab-status-out.log'),
  error_file: path.join(os.homedir(), 'services/logs/homelab-status-error.log'),
  env: { NODE_ENV: 'production', PORT: '3000', HOST: process.env.HOST || '0.0.0.0',
    BOM_DIA_MANAGER: process.env.BOM_DIA_MANAGER || 'pm2',
   
    MINECRAFT_CONTROL_ENABLED: process.env.MINECRAFT_CONTROL_ENABLED || '0',
    TAILSCALE_CONTROL_ENABLED: process.env.TAILSCALE_CONTROL_ENABLED || '0',
    WOL_DESKTOP_MAC: process.env.WOL_DESKTOP_MAC || '',
    WOL_DESKTOP_IP: process.env.WOL_DESKTOP_IP || '',
    WOL_INTERFACE: process.env.WOL_INTERFACE || 'wlan0',
    WOL_BROADCAST: process.env.WOL_BROADCAST || '',
    WOL_PORT: process.env.WOL_PORT || '9' }
}, { name: 'homelab-watchdog', script: 'watchdog.js', cwd: __dirname,
  interpreter: process.execPath, instances: 1, exec_mode: 'fork', autorestart: true,
  restart_delay: 5000, max_memory_restart: '100M', time: true,
  env: { NODE_ENV: 'production', PORT: '3000', BOM_DIA_MANAGER: process.env.BOM_DIA_MANAGER || 'pm2', WATCHDOG_RECOVER_BOM_DIA: '0', MINECRAFT_PORT: '25565',
    CF_ACCESS_PROBE_ID: process.env.CF_ACCESS_PROBE_ID || '',
    CF_ACCESS_PROBE_SECRET: process.env.CF_ACCESS_PROBE_SECRET || '',
    PLAYIT_PUBLIC_HOST: process.env.PLAYIT_PUBLIC_HOST || '',
    PLAYIT_PUBLIC_PORT: process.env.PLAYIT_PUBLIC_PORT || '' }
}] };
