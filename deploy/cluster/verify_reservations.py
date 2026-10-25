"""Exercise real Redis reservations and RQ recovery in disposable test queues."""
import hashlib
import json
import time
import uuid

from rq import Worker
from rq.intermediate_queue import IntermediateQueue
from rq.serializers import JSONSerializer

from cluster import connection, queue
from reserved_queue import ReservedQueue, ReservedWorker
from tasks import hash_text

c = connection()
ReservedWorker([queue('a30', c), queue('general', c)], connection=c,
       queue_class=ReservedQueue, serializer=JSONSerializer)
prefix = 'homelab-reservation-test-' + uuid.uuid4().hex
queues = [ReservedQueue(prefix + suffix, connection=c, serializer=JSONSerializer)
          for suffix in ('-node', '-general')]
jobs = []
cleaner = ReservedWorker(queues, connection=c, queue_class=ReservedQueue,
                 serializer=JSONSerializer, name=prefix + '-cleanup')
try:
    jobs = [q.enqueue(hash_text, label, result_ttl=300, failure_ttl=300)
            for q, label in zip(queues, ('node', 'general'))]
    for expected in jobs:
        result = ReservedQueue.dequeue_any(queues, None, c, serializer=JSONSerializer)
        assert result is not None and result[0].id == expected.id
        iq = IntermediateQueue(result[1].key, c)
        c.connection_pool.disconnect()
        assert expected.id in iq.get_job_ids(), 'Reservation lost across reconnect'
        assert result[1].count == 0
        # Age only this disposable fixture; use RQ's real cleanup/failure path.
        c.set(iq.get_first_seen_key(expected.id), time.time() - 120, ex=300)
        iq.cleanup(cleaner, result[1])
        assert expected.get_status(refresh=True) == 'failed'
        assert expected.id in result[1].failed_job_registry
        result[1].failed_job_registry.requeue(expected.id)
        # Keep the next priority check focused on the other queue.
        result[1].remove(expected.id)
    for q, job in zip(queues, jobs):
        q.enqueue_job(job)
    worker = ReservedWorker(queues, connection=c, queue_class=ReservedQueue,
                    serializer=JSONSerializer, name=prefix + '-execute')
    worker.work(burst=True, logging_level='WARNING')
    for job, label in zip(jobs, ('node', 'general')):
        assert job.get_status(refresh=True) == 'finished'
        assert job.return_value()['sha256'] == hashlib.sha256(label.encode()).hexdigest()
    assert all(c.llen(q.intermediate_queue_key) == 0 for q in queues)
    print(json.dumps({'reservation_survives_reconnect': True,
                      'abandoned_reservation_visible_as_failed': True,
                      'explicit_requeue_executes_both_queues': True,
                      'execution_acknowledges_reservation': True}))
finally:
    for q, job in zip(queues, jobs):
        IntermediateQueue(q.key, c).remove(job.id)
        c.delete(IntermediateQueue(q.key, c).get_first_seen_key(job.id))
        job.delete()
        q.delete(delete_jobs=True)
    c.delete(cleaner.key)
