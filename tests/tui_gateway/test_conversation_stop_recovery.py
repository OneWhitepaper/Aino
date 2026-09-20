"""Logical-turn cancellation and reconnect use real live sessions and registry ownership."""
from __future__ import annotations

import queue
import threading
import time
from types import SimpleNamespace

import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_notifications import _setup, _settle
from tui_gateway.conversation_activity import ConversationActivity, conversation_activity_scope


@pytest.fixture
def registry(monkeypatch):
    from tools import async_delegation as ad
    from tools import delegate_tool_registry as children
    from tools.process_registry import process_registry
    ad._reset_for_tests()
    monkeypatch.setattr(children, '_active_subagents', {})
    mailbox = queue.Queue()
    monkeypatch.setattr(process_registry, 'completion_queue', mailbox)
    finalized = {}
    original = ad._finalize
    def finalize(identity, result, status):
        original(identity, result, status)
        if identity in finalized:
            finalized[identity].set()
    monkeypatch.setattr(ad, '_finalize', finalize)
    controls = []
    yield mailbox, finalized, controls
    for control in controls:
        control.release.set()
    if ad._executor:
        ad._executor.shutdown(wait=True)
    ad._reset_for_tests()


def _child(service, sid, session, attempt, identity, registry):
    from tools import async_delegation as ad
    from tools.delegate_tool_child_run import _register_child
    from tools.delegate_tool_registry import _unregister_subagent
    from tui_gateway.conversation_notifications import capture_conversation_delegation
    _, finalized, controls = registry
    control = SimpleNamespace(started=threading.Event(), stopped=threading.Event(), release=threading.Event())
    controls.append(control)
    finalized[identity] = threading.Event()
    child = SimpleNamespace(_subagent_id='child-' + identity, _delegate_depth=1, _delegation_id=identity, model='test')
    def run():
        _register_child(child, session['agent'], 'Controlled child', owner_session_id=sid,
                        owner_transport=session['transport'], owner_session_record=session)
        control.started.set()
        try:
            assert control.release.wait(30)
            return {'results': [{'task_index': 0, 'status': 'interrupted' if control.stopped.is_set() else 'completed',
                                 'summary': 'Child settled'}]}
        finally:
            _unregister_subagent(child._subagent_id)
    metadata = session['_conversation_binding']
    activity = ConversationActivity(metadata['conversation_id'], attempt.identity.turn_id,
        metadata['participant_id'], metadata['session_generation'], attempt.identity.task_id,
        attempt.execution_generation, sid)
    with conversation_activity_scope(activity, attempt):
        capture_conversation_delegation(session, identity)
        result = ad.dispatch_async_delegation_batch(goals=['Controlled child'], context=None, toolsets=None,
            role='leaf', model='test', runner=run, interrupt_fn=control.stopped.set, delegation_id=identity,
            session_key=session['session_key'], origin_ui_session_id=sid)
    assert result['status'] == 'dispatched'
    assert control.started.wait(10)
    return control, activity


def _other_session(service, general, writer):
    from gateway import hosted_room_driver as driver
    service.create('other', 'Separate conversation', general)
    service.send('other', 'other-turn', 'other-input', writer, 'Separate work', service.store.get('other').revision)
    sid, session = next((sid, session) for sid, session in service.server._sessions.items()
                        if session.get('_conversation_binding', {}).get('conversation_id') == 'other')
    room = next(b for b in service.bindings() if b.room_id == 'other')
    lease = driver.acquire_lease(service.db_path, room_id='other', gateway_id=room.gateway_id,
        authority_epoch=room.authority_epoch, process_generation='other-worker', ttl_seconds=300, clock=time.time)
    task = service._tasks('other')[0]
    attempt = driver.start_task(service.db_path, task['identity'], lease, expected_cancel_generation=0, clock=time.time)
    session['_conversation_attempt'] = attempt
    return sid, session, attempt


def test_stop_fences_only_the_requested_logical_turn_and_waits_for_children(runtime_env, monkeypatch, registry):
    from gateway import hosted_room_driver as driver, hosted_rooms
    from tui_gateway.conversation_notifications import route_conversation_notification
    server, service, notifications, sid, session, lease, attempt, general = _setup(runtime_env, monkeypatch)
    writer = session['_conversation_binding']['participant_id']
    child, _ = _child(service, sid, session, attempt, 'unit-a', registry)
    other_sid, other_session, other_attempt = _other_session(service, general, writer)
    unrelated, _ = _child(service, other_sid, other_session, other_attempt, 'unit-unrelated', registry)
    _settle(service, attempt)
    session.pop('_hosted_room_task', None)
    # Admit one continuation before Stop; its queued driver task must also be cancelled.
    route_conversation_notification(sid, session,
        {'type': 'async_delegation', 'delegation_id': 'unit-a', 'task_failure_notice': True,
         'results': [{'task_index': 0}]}, 'Partial result')
    room = next(b for b in service.bindings() if b.room_id == 'c')
    service.prepare_room(room)
    continuation = next(task for task in service._tasks('c') if task['status'] == 'queued')
    try:
        stale = service.stop('c', 'origin', attempt.execution_generation + 1, include_delegations=True)
        assert stale['status'] == 'not_found'
        assert not child.stopped.is_set()
        with hosted_rooms._transaction(service.db_path) as conn:
            assert conn.execute('SELECT COUNT(*) FROM hosted_conversation_background_fences').fetchone()[0] == 0
        result = service.stop('c', 'origin', attempt.execution_generation, include_delegations=True)
        assert result['status'] == 'requested'
        assert child.stopped.wait(5)
        assert not unrelated.stopped.is_set()
        assert driver.get_task(service.db_path, continuation['identity'])['status'] == 'cancelled'
        child.release.set()
        assert registry[1]['unit-a'].wait(10)
        event = registry[0].get(timeout=10)
        assert route_conversation_notification(sid, session, event, 'Late A result')
        assert service.stop('c', 'origin', attempt.execution_generation, include_delegations=True)['status'] == 'confirmed'
        assert not notifications.pending('c')
        service.send('c', 'b-turn', 'b-input', general, 'B continues', service.store.get('c').revision)
        b_task = next(task for task in service._tasks('c') if task['identity'].turn_id == 'b-turn')
        b_attempt = driver.start_task(service.db_path, b_task['identity'], lease,
                                     expected_cancel_generation=0, clock=time.time)
        # A repeated late delivery neither replaces B nor creates another execution.
        assert route_conversation_notification(sid, session, event, 'Late A result')
        assert driver.get_task(service.db_path, b_task['identity'])['status'] == 'running'
        assert not unrelated.stopped.is_set()
        _settle(service, b_attempt)
    finally:
        child.release.set()
        unrelated.release.set()
        _settle(service, other_attempt)


def test_reconnect_replays_exact_live_generation_children_and_original_requests(runtime_env, monkeypatch, registry):
    from tui_gateway import server_requests
    from tui_gateway.transport import bind_transport, reset_transport
    from gateway.hosted_room_conversation_owners import ConversationOwnershipError
    server, service, notifications, sid, session, lease, attempt, general = _setup(runtime_env, monkeypatch)
    # Prepare's receipt accounts only for its own binding insert and preserves stale drafts.
    from gateway import hosted_rooms
    reviewer = next(row['participant']['participant_id'] for row in service.catalog()
                    if row['participant']['profile'] == 'reviewer')
    revision = service.store.get('c').revision
    existing_sessions = set(server._sessions)
    with pytest.raises(hosted_rooms.RoomConflictError, match='revision'):
        service.prepare('c', reviewer, expected_revision=revision - 1)
    assert set(server._sessions) == existing_sessions
    assert reviewer not in {binding.participant.participant_id for binding in service.store.participants('c')}
    prepared = service.prepare('c', reviewer, expected_revision=revision)
    assert (prepared['previous_revision'], prepared['conversation_revision']) == (revision, revision + 1)
    assert service.store.get('c').revision == prepared['conversation_revision']
    child, activity = _child(service, sid, session, attempt, 'unit-reconnect', registry)
    _settle(service, attempt)
    session.pop('_hosted_room_task', None)
    session['running'] = False
    sent = []
    monkeypatch.setattr(server_requests, '_write', sent.append)
    with conversation_activity_scope(activity, attempt):
        request = server_requests.ServerRequest(sid, 'approval', {'request_id': 'approval-original', 'command': 'echo test'})
        server_requests._register(request)
    class Peer:
        auth_identity = {'provider': 'test', 'user_id': 'creator'}
        def write(self, frame):
            return True
    peer = Peer()
    token = bind_transport(peer)
    try:
        metadata = session['_conversation_binding']
        from gateway import hosted_rooms
        from tui_gateway.conversation_authority import request_owner_key
        with hosted_rooms._transaction(service.db_path) as conn:
            owner = conn.execute('SELECT owner_key FROM hosted_conversation_owners WHERE conversation_id=?', ('c',)).fetchone()[0]
        assert owner == request_owner_key(server), (owner, request_owner_key(server), metadata.get('auth_user_id'))
        result = server._methods['conversations.runtime_snapshot']('snapshot', {
            'conversation_id': 'c', 'participant_id': metadata['participant_id'], 'session_generation': 1})
        assert 'error' not in result, result
        snapshot = result['result']
        assert snapshot['available'] and snapshot['runtime_id'] == sid
        assert snapshot['model_snapshot']['model'] == session['agent'].model
        assert [entry['subagent_id'] for entry in snapshot['subagents']] == ['child-unit-reconnect']
        assert snapshot['activity'] is None
        assert snapshot['background_activities'] == [vars(activity)]
        assert snapshot['open_requests'][0]['id'] == request.id
        assert snapshot['open_requests'][0]['params']['conversation']['turn_id'] == 'origin'
        assert session is server._sessions[sid]
        # Public owner authorization precedes reattachment or request replay.
        foreign = Peer()
        foreign.auth_identity = {'provider': 'test', 'user_id': 'foreign'}
        foreign_token = bind_transport(foreign)
        try:
            with pytest.raises(ConversationOwnershipError):
                service.runtime_snapshot('c', metadata['participant_id'], 1)
        finally:
            reset_transport(foreign_token)
        child.release.set()
        assert registry[1]['unit-reconnect'].wait(10)
        server._sessions.pop(sid)
        unavailable = service.runtime_snapshot('c', metadata['participant_id'], 1)
        assert not unavailable['available'] and unavailable['subagents'] == []
        assert unavailable['model_snapshot'] == snapshot['model_snapshot']
        assert sid not in server._sessions  # no dead-worker resume or hidden runtime construction
    finally:
        reset_transport(token)
        child.release.set()
        server._sessions[sid] = session
        with server_requests._lock:
            server_requests._open.pop(request.id, None)
