const path = require('node:path');
const os = require('node:os');
// Separate from the dashboard ecosystem: routine dashboard updates must not
// restart a Minecraft world. Apply only after the existing server is offline.
module.exports = { apps: [{
  name: 'minecraft',
  script: path.join(os.homedir(), 'minecraft/start.sh'),
  cwd: path.join(os.homedir(), 'minecraft'),
  interpreter: path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'bin/bash'),
  instances: 1, exec_mode: 'fork', autorestart: false,
  watch: false, kill_timeout: 120000, time: true
}] };
