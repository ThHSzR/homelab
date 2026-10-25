#!/usr/bin/env python3
"""Idempotently start only this cluster's PM2 entries; leave the shared dump alone."""
import json
from pathlib import Path
import subprocess
import time

from redis import Redis

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / 'cluster.json').read_text())


def ensure(name):
    processes = json.loads(subprocess.check_output(['pm2', 'jlist'], text=True))
    existing = [p for p in processes if p.get('name') == name]
    if len(existing) > 1:
        raise RuntimeError('Ambiguous PM2 process: ' + name)
    if existing and existing[0].get('pm2_env', {}).get('status') == 'online':
        return
    subprocess.run(['pm2', 'start', str(ROOT / 'ecosystem.config.cjs'), '--only', name],
                   cwd=ROOT, check=True)


ensure('homelab-cluster-redis' if config['coordinator'] else 'homelab-cluster-link')
broker = Redis(**config['redis'], socket_connect_timeout=3, socket_timeout=3)
try:
    broker.ping()
except Exception:
    print('Broker not ready; PM2 will retry worker and transport as the network returns')
ensure('homelab-cluster-worker')
print('Cluster startup checked:', config['node'])
