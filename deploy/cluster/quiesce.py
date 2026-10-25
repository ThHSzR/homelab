"""Stop this worker before disconnecting its broker during a planned reboot."""
import subprocess

from pm2_runtime import PM2
from tasks import config

subprocess.run(PM2 + ['stop', 'homelab-cluster-worker'], check=True, timeout=45)
if not config()['coordinator']:
    subprocess.run(PM2 + ['stop', 'homelab-cluster-link'], check=True, timeout=15)
print('Worker stopped; planned device reboot may proceed')
