#!/usr/bin/env python3
"""RQ cluster control; Redis remains on loopback and travels over SSH."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from redis import Redis
from rq import Queue, Worker
from rq.job import Job
from rq.registry import FailedJobRegistry, StartedJobRegistry
from rq.serializers import JSONSerializer

import tasks

ROOT = Path(__file__).resolve().parent
TASKS = {
    'health': tasks.node_health,
    'hash': tasks.hash_text,
    'probe': tasks.probe_service,
    'services': tasks.service_status,
}
QUEUE_NAMES = ('a30', 'a10s', 'general')


def connection():
    return Redis(**tasks.config()['redis'], socket_connect_timeout=5,
                 health_check_interval=30)


def queue(name, conn):
    return Queue(name, connection=conn, serializer=JSONSerializer,
                 default_timeout=30)


def status(conn):
    workers = Worker.all(connection=conn, serializer=JSONSerializer)
    return {
        'redis': bool(conn.ping()),
        'workers': [
            {'name': w.name, 'state': str(w.get_state()),
             'queues': w.queue_names(), 'last_heartbeat': str(w.last_heartbeat)}
            for w in workers
        ],
        'queues': {
            name: {
                'waiting': queue(name, conn).count,
                'started': StartedJobRegistry(name, connection=conn).count,
                'failed': FailedJobRegistry(name, connection=conn).count,
            } for name in QUEUE_NAMES
        },
    }


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('status')
    work = sub.add_parser('worker')
    work.add_argument('--burst', action='store_true')
    submit = sub.add_parser('submit')
    submit.add_argument('task', choices=TASKS)
    submit.add_argument('--node', choices=QUEUE_NAMES, default='general')
    submit.add_argument('--argument')
    submit.add_argument('--wait', type=int, default=0)
    result = sub.add_parser('result')
    result.add_argument('id')
    args = parser.parse_args()
    conn = connection()
    if args.action == 'status':
        output = status(conn)
    elif args.action == 'worker':
        cfg = tasks.config()
        queues = [queue(name, conn) for name in cfg['queues']]
        os.nice(10)
        worker = Worker(queues, name='homelab-' + cfg['node'], connection=conn,
                        serializer=JSONSerializer, worker_ttl=120,
                        maintenance_interval=60, log_job_description=False)
        worker.work(burst=args.burst, logging_level='INFO')
        return
    elif args.action == 'submit':
        parameters = () if args.argument is None else (args.argument,)
        job = queue(args.node, conn).enqueue(
            TASKS[args.task], *parameters, result_ttl=86400,
            failure_ttl=604800, job_timeout=30,
        )
        deadline = time.monotonic() + min(max(args.wait, 0), 120)
        while args.wait and time.monotonic() < deadline:
            if job.get_status(refresh=True) in ('finished', 'failed', 'stopped', 'canceled'):
                break
            time.sleep(0.25)
        output = {'id': job.id, 'queue': args.node,
                  'status': job.get_status(refresh=True), 'result': job.return_value()}
    else:
        job = Job.fetch(args.id, connection=conn, serializer=JSONSerializer)
        output = {'id': job.id, 'status': job.get_status(refresh=True),
                  'result': job.return_value()}
    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))


if __name__ == '__main__':
    main()
