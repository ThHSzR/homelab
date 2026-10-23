'use strict';

// Separate PM2 ecosystem: never reloads homelab-status, watchdog or Minecraft.
const path = require('node:path');
const os = require('node:os');
module.exports = {
  apps: [{
    name: 'bookforge-a30',
    script: 'bookforge.js',
    args: 'daemon',
    cwd: __dirname,
    interpreter: process.execPath,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 15000,
    max_memory_restart: '160M', // Worker only; llama-server is a child process.
    time: true,
    out_file: path.join(os.homedir(), 'services/logs/bookforge-out.log'),
    error_file: path.join(os.homedir(), 'services/logs/bookforge-error.log'),
    env: {
      NODE_ENV: 'production',
      BOOK_INTERVAL_DAYS: process.env.BOOK_INTERVAL_DAYS || '15',
      BOOK_AUTO_SEND: process.env.BOOK_AUTO_SEND || '0',
      BOOK_EMAIL_FROM: process.env.BOOK_EMAIL_FROM || '',
      BOOK_KINDLE_TO: process.env.BOOK_KINDLE_TO || ''
    }
  }]
};
