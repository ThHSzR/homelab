'use strict';

// One-shot pilot under PM2: survives SSH disconnect and does NOT restart on completion.
const path = require('node:path');
const os = require('node:os');
module.exports = {
  apps: [{
    name: 'bookforge-pilot',
    script: 'bookforge.js',
    args: 'run',
    cwd: __dirname,
    interpreter: process.execPath,
    instances: 1,
    exec_mode: 'fork',
    autorestart: false,
    kill_timeout: 15000,
    time: true,
    out_file: path.join(os.homedir(), 'services/logs/bookforge-pilot-out.log'),
    error_file: path.join(os.homedir(), 'services/logs/bookforge-pilot-error.log'),
    env: {
      BOOK_CHAPTERS: process.env.BOOK_CHAPTERS || '2',
      BOOK_SCENES_PER_CHAPTER: process.env.BOOK_SCENES_PER_CHAPTER || '1',
      BOOK_MAX_TOKENS: process.env.BOOK_MAX_TOKENS || '350',
      BOOK_AUTO_SEND: '0'
    }
  }]
};
