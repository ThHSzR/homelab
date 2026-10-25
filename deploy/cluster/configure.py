"""Create private, local coordinator settings without printing credentials."""
import json
from pathlib import Path
import secrets
import socket

ROOT = Path(__file__).resolve().parent
path = ROOT / 'cluster.json'
if path.exists():
    raise SystemExit('Configuration already exists; refusing to overwrite')
with socket.socket() as check:
    check.bind(('127.0.0.1', 16379))
for name in ('logs', 'state'):
    (ROOT / name).mkdir(exist_ok=True, mode=0o700)
password = secrets.token_hex(32)
settings = {
    'node': 'a30', 'coordinator': True, 'queues': ['a30', 'general'],
    'redis': {'host': '127.0.0.1', 'port': 16379, 'db': 0, 'password': password},
    'services': {},
}
path.write_text(json.dumps(settings, indent=2) + '\n')
path.chmod(0o600)
redis = ROOT / 'redis.conf'
redis.write_text('\n'.join([
    'bind 127.0.0.1', 'port 16379', 'protected-mode yes',
    'requirepass ' + password, 'daemonize no', 'logfile ""',
    'dir ' + str(ROOT / 'state'), 'appendonly yes',
    'appendfilename "cluster.aof"', 'appendfsync everysec', 'save ""',
    'maxmemory 64mb', 'maxmemory-policy noeviction',
    'databases 1', 'tcp-keepalive 60', 'slowlog-max-len 64', '',
]))
redis.chmod(0o600)
print('Private coordinator settings created on a30')
