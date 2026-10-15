#!/data/data/com.termux/files/usr/bin/bash
set -eu

# Run as the same Termux user that owns the HomeLab PM2 daemon.
if ! pm2 describe pm2-logrotate >/dev/null 2>&1; then
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size 5M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 conf
