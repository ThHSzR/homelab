// Execute separadamente do ecosystem.config.cjs principal.
// A agenda só gera livros se schedule.enabled=true em config.json.
module.exports = {
  apps: [{
    name: 'kindle-fiction-scheduler',
    script: 'src/scheduler.mjs',
    cwd: __dirname,
    interpreter: process.execPath,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    restart_delay: 10000,
    max_memory_restart: '120M',
    time: true,
    env: { NODE_ENV: 'production' }
  }]
};
