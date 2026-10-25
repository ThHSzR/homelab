#!/usr/bin/env python3
"""Idempotently start only this cluster's PM2 entries; leave the shared dump alone."""
import json
from pathlib import Path
import subprocess

from redis import Redis
from pm2_runtime import PM2

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / 'cluster.json').read_text())


def ensure(name, ecosystem=ROOT / 'ecosystem.config.cjs'):
    processes = json.loads(subprocess.check_output(PM2 + ['jlist'], text=True, timeout=15))
    existing = [p for p in processes if p.get('name') == name]
    if len(existing) > 1:
        raise RuntimeError('Ambiguous PM2 process: ' + name)
    if existing and existing[0].get('pm2_env', {}).get('status') == 'online':
        return
    subprocess.run(PM2 + ['start', str(ecosystem), '--only', name],
                   cwd=ecosystem.parent, check=True, timeout=30)


# Cold PM2 startup writes a banner to stdout; finish it before reading JSON.
subprocess.run(PM2 + ['ping'], check=True, stdout=subprocess.DEVNULL, timeout=30)
if not config['coordinator'] and config['master'].get('transport') == 'tailscale':
    ensure('tailscale-userspace', ROOT.parent / 'tailscale-userspace/ecosystem.config.cjs')
ensure('homelab-cluster-redis' if config['coordinator'] else 'homelab-cluster-link')
broker = Redis(**config['redis'], socket_connect_timeout=3, socket_timeout=3)
try:
    broker.ping()
except Exception:
    print('Broker not ready; PM2 will retry worker and transport as the network returns')
ensure('homelab-cluster-worker')
print('Cluster startup checked:', config['node'])
