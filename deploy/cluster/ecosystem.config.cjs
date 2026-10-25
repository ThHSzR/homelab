const path = require('path');
const fs = require('fs');
const root = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(root, 'cluster.json'), 'utf8'));
const apps = [];
if (config.coordinator) {
  apps.push({
    name: 'homelab-cluster-redis',
    script: '/data/data/com.termux/files/usr/bin/redis-server',
    args: [path.join(root, 'redis.conf')],
    interpreter: 'none', cwd: root, autorestart: true,
    min_uptime: 10000, restart_delay: 5000, kill_timeout: 15000,
    out_file: path.join(root, 'logs/redis-out.log'),
    error_file: path.join(root, 'logs/redis-error.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  });
} else {
  const master = config.master;
  const transportArgs = master.transport === 'tailscale'
    ? ['-o', 'ProxyCommand=' + path.join(root, 'tailscale-ssh-proxy.sh') + ' %h %p']
    : [];
  apps.push({
    name: 'homelab-cluster-link',
    script: '/data/data/com.termux/files/usr/bin/ssh',
    args: [
      '-NT', '-L', '127.0.0.1:16379:127.0.0.1:16379',
      '-p', String(master.port || 8022),
      '-i', path.join(root, 'ssh/id_ed25519'),
      '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=' + path.join(root, 'ssh/known_hosts'),
      ...transportArgs,
      master.user + '@' + master.host,
    ],
    interpreter: 'none', cwd: root,
    autorestart: true, min_uptime: 0, restart_delay: 10000,
    out_file: path.join(root, 'logs/link-out.log'),
    error_file: path.join(root, 'logs/link-error.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  });
}
apps.push({
  name: 'homelab-cluster-worker',
  script: path.join(root, '.venv/bin/python'),
  args: [path.join(root, 'cluster.py'), 'worker'],
  interpreter: 'none', cwd: root,
  env: { PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
  autorestart: true, min_uptime: 0, restart_delay: 10000,
  kill_timeout: 35000,
  out_file: path.join(root, 'logs/worker-out.log'),
  error_file: path.join(root, 'logs/worker-error.log'),
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
});
module.exports = {apps};
