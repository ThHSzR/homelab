"""Small, explicit jobs shared by the two Termux nodes."""
import hashlib
import json
import os
import platform
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def config():
    return json.loads((ROOT / 'cluster.json').read_text())


def node_health():
    cfg = config()
    memory = {}
    try:
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            if key in ('MemTotal', 'MemAvailable'):
                memory[key] = int(value.split()[0])
    except (OSError, ValueError):
        pass
    disk = os.statvfs(ROOT)
    return {
        'node': cfg['node'], 'machine': platform.machine(),
        'python': platform.python_version(), 'pid': os.getpid(),
        'time': time.time(), 'memory_kib': memory,
        'disk_free_bytes': disk.f_bavail * disk.f_frsize,
    }


def hash_text(text):
    if not isinstance(text, str) or len(text.encode()) > 65536:
        raise ValueError('text must be at most 64 KiB')
    return {'node': config()['node'], 'sha256': hashlib.sha256(text.encode()).hexdigest()}


def probe_service(name):
    """Probe only services explicitly registered by the owner on this node."""
    services = config().get('services', {})
    if name not in services:
        raise ValueError('unknown service')
    url = services[name]
    if not url.startswith(('http://', 'https://')):
        raise ValueError('HTTP service required')
    started = time.monotonic()
    with urllib.request.urlopen(url, timeout=5) as response:
        return {'node': config()['node'], 'service': name,
                'status': response.status, 'seconds': time.monotonic() - started}


def service_status():
    """Return PM2 process state without environment, arguments or credentials."""
    result = subprocess.run(['pm2', 'jlist'], capture_output=True, text=True,
                            timeout=10, check=True)
    return {'node': config()['node'], 'services': [
        {'name': item['name'], 'status': item.get('pm2_env', {}).get('status'),
         'pid': item.get('pid'), 'memory': item.get('monit', {}).get('memory')}
        for item in json.loads(result.stdout)]}
