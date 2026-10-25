"""Retain RQ reservations when polling multiple queues over an SSH tunnel."""
import time

from rq import Queue, Worker
from rq.exceptions import DequeueTimeout
from rq.utils import get_version


class ReservedQueue(Queue):
    @classmethod
    def dequeue_any(cls, queues, timeout, connection, **kwargs):
        if get_version(connection) < (6, 2, 0):
            raise RuntimeError('ReservedQueue requires Redis 6.2 or newer')
        if timeout == 0:
            raise ValueError('A blocking dequeue timeout must be positive')
        queues = tuple(queues)
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            for queue in queues:
                # RQ uses LMOVE into its intermediate queue for a single queue.
                # Multiple queues otherwise use destructive BLPOP. Poll each
                # separately to preserve a reservation if the connection drops.
                result = super().dequeue_any([queue], None, connection, **kwargs)
                if result is not None:
                    return result
            if deadline is None:
                return None
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise DequeueTimeout(timeout, [q.key for q in queues])
            time.sleep(min(1, remaining))


class ReservedWorker(Worker):
    def prepare_job_execution(self, job, remove_from_intermediate_queue=False):
        # RQ assumes multiple queues used BLPOP. Our dequeue always reserves,
        # so acknowledge that reservation in the normal execution transaction.
        return super().prepare_job_execution(job, remove_from_intermediate_queue=True)
