"""The FIFO claim's pending-row reads wait off the owner loop.

Every turn's drain reads the session's pending admissions before its claim (and re-reads the head
after an awaited preclaim check). On slow storage that read used to stop the whole owner loop, every
other session's turn, Stop and socket included. Real SessionAuthority + state.db; reads are slowed
only for the session under test and only while the drain claims, and the stall is measured as
loop-tick lag. The claim still takes the head the read validated.
"""

from persistence_assembly import open_persistence, profile_scope

from dataclasses import asdict
import asyncio
import threading
import time
from types import SimpleNamespace

import pytest

from tests.fixtures.storage_seed import seed_session
from tests.gateway.fixtures.storage_handles import close_storage_handles, storage_handle

SLOW_S = 2.0


@pytest.mark.asyncio
async def test_claim_pending_read_keeps_the_owner_loop_ticking(tmp_path, monkeypatch):
    from gateway.session_authority import LiveSession, SessionAuthority
    from gateway.session_contract import SessionRef
    from persistence.sqlite.authority.admissions import SQLiteAdmissionRepository
    db = storage_handle(tmp_path)
    seed_session(db, 's', 'cron')
    authority = SessionAuthority(SimpleNamespace(_draining=False, adapters={}), profile_id='p', instance_id='t',
                                 persistence=db, epoch=db.runtime.begin_epoch(instance_id='t'))
    live = authority.sessions['s'] = LiveSession(SimpleNamespace(platform=None, user_id='u'), 'route')
    row, _ = db.admissions.admit(epoch=authority.epoch, principal_id='u', session_id='s',
                                 request_id='r1', payload={'text': 'x'})
    real, slow = SQLiteAdmissionRepository.list, threading.Event()
    owner_thread = threading.get_ident()
    read_threads = []

    def slow_list(*args, **kwargs):
        if slow.is_set():
            read_threads.append(threading.get_ident())
            time.sleep(SLOW_S)  # health: allow HX013 -- the slow storage read IS the stall under test
        return real(*args, **kwargs)
    monkeypatch.setattr(SQLiteAdmissionRepository, 'list', slow_list)
    gaps = []
    claim_returned, tick_after_claim = threading.Event(), asyncio.Event()

    async def tick():
        last = time.monotonic()
        while True:
            await asyncio.sleep(0.02)  # health: allow HX013 -- the ticker's period is the owner-loop stall measurement
            now = time.monotonic()
            gaps.append(now - last)
            last = now
            if claim_returned.is_set():
                tick_after_claim.set()
    ticker = asyncio.create_task(tick())
    await asyncio.sleep(0.05)  # health: allow HX013 -- the ticker runs before the claim starts
    slow.set()
    try:
        claimed, first = await asyncio.wait_for(authority._claim_next(SessionRef('p', 's'), live), 30)
        claim_returned.set()
        await asyncio.wait_for(tick_after_claim.wait(), 1)
    finally:
        slow.clear()
        ticker.cancel()
        db.close()
    assert first['admission_id'] == row.admission_id
    assert claimed and claimed['admission_id'] == row.admission_id and claimed['status'] == 'started'
    assert read_threads and all(thread_id != owner_thread for thread_id in read_threads)
    assert max(gaps) < 0.2, f'owner loop stalled {max(gaps):.2f}s behind the claim read'


@pytest.mark.asyncio
async def test_claim_is_execution_stamped_before_the_pending_snapshot_wait(tmp_path, monkeypatch):
    from gateway.session_authority import LiveSession, SessionAuthority
    from gateway.session_contract import SessionRef

    with open_persistence(profile_scope(home=(tmp_path / 'state.db').parent)) as db:
        seed_session(db, 's', source='cron')
        authority = SessionAuthority(SimpleNamespace(_draining=False, adapters={}), profile_id='p', instance_id='t',
                                     persistence=db, epoch=db.runtime.begin_epoch(instance_id='t'))
        live = authority.sessions['s'] = LiveSession(SimpleNamespace(platform=None, user_id='u'), 'route')
        ref = SessionRef('p', 's')
        admitted = asdict(db.admissions.admit(epoch=authority.epoch, principal_id='u', session_id='s', request_id='r1', payload={'text': 'x'})[0])
        entered, release = threading.Event(), threading.Event()
        snapshot = authority._pending_publication_snapshot

        def blocked_snapshot(*args):
            entered.set()
            assert release.wait(10), 'snapshot was not released'
            return snapshot(*args)

        monkeypatch.setattr(authority, '_pending_publication_snapshot', blocked_snapshot)
        frames = []
        live.event_stream.observers.add(frames.append)
        claim = asyncio.create_task(authority._claim_next(ref, live))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            row = asdict(db.admissions.get(admission_id=admitted['admission_id']))
            assert row['status'] == 'started'
            assert authority.executing.get('s') == row['generation']
            assert live.event_stream.execution['admission_id'] == row['admission_id']
            assert [frame['params']['type'] for frame in frames] == ['message.start']
        finally:
            release.set()
            await asyncio.wait_for(claim, 10)
        assert [frame['params']['type'] for frame in frames] == ['message.start', 'session.info']
        assert frames[-1]['params']['payload']['running'] is True


@pytest.mark.asyncio
async def test_claim_pending_publication_does_not_overwrite_a_newer_queue_snapshot(tmp_path, monkeypatch):
    from gateway.session_authority import LiveSession, SessionAuthority
    from gateway.session_contract import SessionRef

    with open_persistence(profile_scope(home=(tmp_path / 'state.db').parent)) as db:
        seed_session(db, 's', source='cron')
        authority = SessionAuthority(SimpleNamespace(_draining=False, adapters={}), profile_id='p', instance_id='t',
                                     persistence=db, epoch=db.runtime.begin_epoch(instance_id='t'))
        live = authority.sessions['s'] = LiveSession(SimpleNamespace(platform=None, user_id='u'), 'route')
        ref = SessionRef('p', 's')
        asdict(db.admissions.admit(epoch=authority.epoch, principal_id='u', session_id='s', request_id='r1', payload={'text': 'first'})[0])
        entered, release = threading.Event(), threading.Event()
        snapshot = authority._pending_publication_snapshot
        stale_read = False

        def blocked_snapshot(*args):
            nonlocal stale_read
            current = snapshot(*args)
            if not stale_read:
                stale_read = True
                entered.set()
                assert release.wait(10), 'snapshot was not released'
            return current

        monkeypatch.setattr(authority, '_pending_publication_snapshot', blocked_snapshot)
        frames = []
        live.event_stream.observers.add(frames.append)
        claim = asyncio.create_task(authority._claim_next(ref, live))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            follower = asdict(db.admissions.admit(epoch=authority.epoch, principal_id='u', session_id='s', request_id='r2', payload={'text': 'newly queued'})[0])
            authority._publish_pending(ref)
        finally:
            release.set()
            await asyncio.wait_for(claim, 10)
        published = [frame['params']['payload']['pending'] for frame in frames
                     if frame['params']['type'] == 'session.info']
        assert len(published) >= 2
        assert all(any(row['admission_id'] == follower['admission_id'] for row in pending) for pending in published)
