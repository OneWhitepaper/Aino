"""Real background dispatch retains origin and joins the existing Hosted turn queue."""
from __future__ import annotations

import json
import queue
import threading
import time
from unittest.mock import MagicMock

import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tui_gateway.conversation_activity import conversation_activity_scope


@pytest.fixture
def provider(runtime_env):
    from http.server import HTTPServer
    import yaml
    from tests.agent.test_api_content_sidecar import _MockHandler
    _MockHandler.captured_requests = []
    _MockHandler.response_queue = []
    http = HTTPServer(('127.0.0.1', 0), _MockHandler)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    home = runtime_env[3]
    for target in (home, home / 'profiles' / 'writer'):
        path = target / 'config.yaml'
        config = yaml.safe_load(path.read_text())
        config['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
        config['compression'] = {'enabled': False}
        path.write_text(yaml.safe_dump(config))
    yield http
    http.shutdown()
    worker.join(5)
    http.server_close()


def _setup(runtime_env, monkeypatch):
    from tui_gateway.conversation_service import ConversationService
    from gateway.hosted_room_conversation_notifications import ConversationNotifications
    server, store, install, home, _ = runtime_env
    service = ConversationService(server, db_path=store.db_path)
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)
    participants = [row['participant'] for row in service.catalog() if row['available']]
    general = next(row['participant_id'] for row in participants if row['is_general'])
    writer = next(row['participant_id'] for row in participants if row['profile'] == 'writer')
    service.create('c', 'Work', general)
    service.send('c', 'origin', 'input-origin', writer, 'Delegate research',
                 service.store.get('c').revision)
    session = next(s for s in server._sessions.values() if s.get('_conversation_binding', {}).get('participant_id') == writer)
    sid = next(sid for sid, value in server._sessions.items() if value is session)
    from gateway import hosted_room_driver as driver
    lease = driver.acquire_lease(store.db_path, room_id='c', gateway_id=install, authority_epoch=1,
                                 process_generation='notification-test', ttl_seconds=300, clock=time.time)
    task = service._tasks('c')[0]
    attempt = driver.start_task(store.db_path, task['identity'], lease, expected_cancel_generation=0, clock=time.time)
    session['_conversation_attempt'] = attempt
    return server, service, ConversationNotifications(service.store), sid, session, lease, attempt, general


def _settle(service, attempt):
    from gateway import hosted_room_driver as driver
    driver.settle_task(service.db_path, attempt, settlement_id='settled:' + attempt.identity.turn_id,
                       status='settled', result={'text': 'done'}, clock=time.time)


def test_actual_parallel_delegation_returns_to_origin_after_foreground_switch(runtime_env, monkeypatch, provider):
    from tools import async_delegation as ad, delegate_tool as dt, delegate_tool_config as config
    from tools.process_registry import process_registry
    from gateway.session_context import set_session_vars, clear_session_vars
    from tui_gateway.transport import bind_transport, reset_transport
    from tui_gateway.conversation_notifications import route_conversation_notification, drain_conversation_notifications
    from gateway import hosted_room_driver as driver
    from tui_gateway.hosted_room_driver import HostedRoomBinding
    server, service, notifications, sid, session, lease, attempt, general = _setup(runtime_env, monkeypatch)
    ad._reset_for_tests()
    mailbox = queue.Queue()
    monkeypatch.setattr(process_registry, 'completion_queue', mailbox)
    monkeypatch.setattr(config, '_get_independent_completions', lambda: True)
    started = [threading.Event(), threading.Event()]
    finish = [threading.Event(), threading.Event()]
    children = []
    def build(**kwargs):
        child = MagicMock()
        child._delegate_role = 'leaf'
        child._subagent_id = f'child-{len(children)}'
        children.append(child)
        return child
    def run(task_index, **kwargs):
        # Durable ownership exists before the executor begins model work.
        assert any(origin['origin_turn_id'] == 'origin' for origin in notifications.delegations('c'))
        started[task_index].set()
        assert finish[task_index].wait(15)
        return {'task_index': task_index, 'status': 'completed', 'summary': f'Research {task_index}',
                'api_calls': 1, 'duration_seconds': .1, 'model': 'test', 'exit_reason': 'completed'}
    monkeypatch.setattr(dt, '_build_child_agent', build)
    monkeypatch.setattr(dt, '_run_single_child', run)
    monkeypatch.setattr(dt, '_resolve_delegation_credentials', lambda *a, **kw: {
        'model': 'test', 'provider': None, 'base_url': None, 'api_key': None,
        'api_mode': None, 'command': None, 'args': None})
    transport_token = bind_transport(session['transport'])
    tokens = set_session_vars(platform='tui', source='desktop', ui_session_id=sid,
                              session_id=session['session_key'], session_key=session['session_key'], async_delivery=True)
    try:
        with conversation_activity_scope(None, attempt):
            result = json.loads(dt.delegate_task(tasks=[{'goal': 'Research topic one'}, {'goal': 'Research topic two'}],
                                                parent_agent=session['agent'], background=True))
        assert result.get('status') == 'dispatched', result
        assert all(e.wait(5) for e in started)
        units = result['units']
        assert all(notifications.origin(u['delegation_id'])['origin_turn_id'] == 'origin' for u in units)
        _settle(service, attempt)
        session.pop('_hosted_room_task', None)
        from tui_gateway.session_conversation_binding import ConversationBindingError
        with pytest.raises(ConversationBindingError, match='background'):
            service.refresh('c', session['_conversation_binding']['participant_id'], 1)
        # B is a separate running foreground task; A's completed parent no longer owns that slot.
        service.send('c', 'foreground-b', 'input-b', general, 'B work', service.store.get('c').revision)
        btask = next(t for t in service._tasks('c') if t['identity'].turn_id == 'foreground-b')
        battempt = driver.start_task(service.db_path, btask['identity'], lease,
                                     expected_cancel_generation=0, clock=time.time)
        room = HostedRoomBinding('c', lease.gateway_id, lease.authority_epoch)
        for index in range(2):
            finish[index].set()
            event = mailbox.get(timeout=10)
            assert route_conversation_notification(sid, session, event, f'Result {index}')
            assert route_conversation_notification(sid, session, event, f'Result {index}')
            assert not drain_conversation_notifications(service, room)
        pending = notifications.pending('c')
        assert len(pending) == 2
        assert {row['participant_id'] for row in pending} == {session['_conversation_binding']['participant_id']}
        assert {row['origin_turn_id'] for row in pending} == {'origin'}
        assert driver.get_task(service.db_path, btask['identity'])['status'] == 'running'
        assert server._session_has_active_delegations(sid, session)
        _settle(service, battempt)
        from gateway.hosted_room_conversation_admission import ConversationBusyError
        with pytest.raises(ConversationBusyError):
            service.send('c', 'racing-user', 'racing-input', general, 'User draft', service.store.get('c').revision)
        service.prepare_room(room)

        continuation = next(t for t in service._tasks('c') if t['status'] == 'queued')
        frozen = service.store.input_for_task(continuation)
        assert frozen['participant_id'] == session['_conversation_binding']['participant_id']
        assert frozen['turn_id'] == pending[0]['continuation_turn_id']
        assert len(notifications.pending('c')) == 1
        assert not drain_conversation_notifications(service, room)
        # Execute the production queue through the Hosted driver, real prompt.submit and Profile input receipt.
        from tui_gateway.hosted_room_service import HostedRoomService
        driver.release_lease(service.db_path, lease, clock=time.time)
        hosted = HostedRoomService(server, db_path=service.db_path)
        monkeypatch.setattr(server, 'get_conversation_service', lambda: hosted.conversations)
        hosted.runtime.turn_timeout_seconds = 15
        hosted.runtime._process_room(room)
        finished = driver.get_task(service.db_path, continuation['identity'])
        assert finished['status'] == 'settled', finished
        envelope = service.store.prepared_input('c', frozen['input_id'])
        receipt = session['agent']._session_db.get_conversation_input_receipt(frozen['input_id'])
        assert receipt.input_digest == envelope.input_digest
        hosted.conversations.prepare_room(room)
        published = [event for event in service.store.events('c').events
                     if event['kind'] == 'conversation.response' and event['payload']['turn_id'] == frozen['turn_id']]
        assert len(published) == 1 and published[0]['actor']['id'] == frozen['participant_id']
    finally:
        for event in finish:
            event.set()
        if ad._executor:
            ad._executor.shutdown(wait=True)
        ad._reset_for_tests()
        clear_session_vars(tokens)
        reset_transport(transport_token)


def test_failed_admission_releases_claim_and_cancelled_origin_never_wakes(runtime_env, monkeypatch):
    from tools import async_delegation as ad
    from tools.process_registry import process_registry
    from tui_gateway.conversation_notifications import capture_conversation_delegation, route_conversation_notification
    from gateway.hosted_room_conversation_notifications import ConversationNotifications
    server, service, notifications, sid, session, lease, attempt, _ = _setup(runtime_env, monkeypatch)
    ad._reset_for_tests()
    mailbox = queue.Queue()
    monkeypatch.setattr(process_registry, 'completion_queue', mailbox)
    with conversation_activity_scope(None, attempt):
        capture_conversation_delegation(session, 'unit')
    result = ad.dispatch_async_delegation_batch(goals=['work'], context=None, toolsets=None, role='leaf', model='test',
        runner=lambda: {'results': [{'task_index': 0, 'status': 'completed', 'summary': 'done'}]},
        delegation_id='unit', session_key=session['session_key'], origin_ui_session_id=sid)
    try:
        assert result['status'] == 'dispatched'
        event = mailbox.get(timeout=10)
        original = ConversationNotifications.enqueue
        def fail(*args, **kwargs):
            raise OSError('database unavailable')
        monkeypatch.setattr(ConversationNotifications, 'enqueue', fail)
        for _ in range(ad._MAX_DELIVERY_ATTEMPTS + 2):
            with pytest.raises(OSError):
                route_conversation_notification(sid, session, event, 'Done')
        assert ad.get_durable_delegation('unit')['delivery_state'] == 'pending'
        assert ad.get_durable_delegation('unit')['delivery_attempts'] == 0
        monkeypatch.setattr(ConversationNotifications, 'enqueue', original)
        # Kanban only advances its source cursor after durable admission succeeds.
        from hermes_cli import kanban_db as kb, kanban_db_connect as kbc, kanban_db_notify as kbn
        from tui_gateway.conversation_notifications import capture_conversation_tool_result
        with kbc.connect() as conn:
            tid = kb.create_task(conn, title='Managed work', assignee='worker')
            kbn.add_notify_sub(conn, task_id=tid, platform='tui', chat_id=session['session_key'])
            before = kbn.list_notify_subs(conn, task_id=tid)[0]['last_event_id']
            kb.block_task(conn, tid, reason='Waiting for review')
        with conversation_activity_scope(None, attempt):
            capture_conversation_tool_result(session, 'kanban_create', {'task_id': tid, 'subscribed': True})
        monkeypatch.setattr(ConversationNotifications, 'enqueue', fail)
        with pytest.raises(OSError):
            server._kb_poll_board(kb, kb.DEFAULT_BOARD, session['session_key'], session)
        with kbc.connect() as conn:
            assert kbn.list_notify_subs(conn, task_id=tid)[0]['last_event_id'] == before
        monkeypatch.setattr(ConversationNotifications, 'enqueue', original)
        server._kb_poll_board(kb, kb.DEFAULT_BOARD, session['session_key'], session)
        count = len(notifications.pending('c'))
        assert count > 0
        server._kb_poll_board(kb, kb.DEFAULT_BOARD, session['session_key'], session)
        assert len(notifications.pending('c')) == count
        with kbc.connect() as conn:
            assert kbn.list_notify_subs(conn, task_id=tid)[0]['last_event_id'] > before
        resource_id = f"kanban:{kb.kanban_db_path().resolve()}:{tid}"
        assert notifications.origin(resource_id)['state'] == 'pending'
        with kbc.connect() as conn:
            kb.complete_task(conn, tid, summary='Complete')
        server._kb_poll_board(kb, kb.DEFAULT_BOARD, session['session_key'], session)
        assert notifications.origin(resource_id)['state'] == 'completed'
        count = len(notifications.pending('c'))
        # All same-session wake paths queue without seizing the running foreground slot.
        from hermes_cli.loops import LoopManager
        from hermes_cli.heartbeat import HeartbeatManager, save_heartbeat
        def forbidden_direct_submit(*args, **kwargs):
            raise AssertionError('managed wake bypassed Hosted admission')
        monkeypatch.setattr(server, '_run_prompt_submit', forbidden_direct_submit)
        session['running'] = True
        LoopManager(session['session_key']).set('Check the running work', times=1)
        heartbeat = HeartbeatManager(session['session_key']).set('Check background health', 60)
        heartbeat.created_at = time.time() - 3600
        save_heartbeat(session['session_key'], heartbeat)
        server._maybe_fire_tui_loop_tick(sid, session)
        server._maybe_fire_tui_heartbeat_tick(sid, session)
        assert len(notifications.pending('c')) == count + 2
        from types import SimpleNamespace
        with conversation_activity_scope(None, attempt):
            server._after_complete_turn(sid, session, SimpleNamespace(tts_queue=True), 'Foreground done')
        assert LoopManager(session['session_key']).state.awaiting_response
        with conversation_activity_scope(None, attempt):
            capture_conversation_delegation(session, 'process:finished-command')
        process_event = {'type': 'completion', 'session_id': 'finished-command', 'session_key': session['session_key']}
        server._notif_handle_event(sid, session, process_event, set(), process_registry,
                                   lambda event: 'Command completed', None, owned=True)
        assert len(notifications.pending('c')) == count + 3
        assert session['running'] is True
        with conversation_activity_scope(None, attempt):
            capture_conversation_delegation(session, 'cancel-before-start')
        notifications.cancel('c', origin_turn_id='origin')
        # Stop can land after origin capture but before the registry starts its worker.
        from tools.delegate_tool_dispatch import _Batch, _dispatch_unit
        child = MagicMock()
        child._delegate_role = 'leaf'
        task = {'goal': 'Must not execute after cancellation'}
        batch = _Batch(task_list=[task], children=[(0, task, child)], parent_agent=session['agent'],
            creds={'model': 'test'}, context=None, top_role='leaf', max_children=1,
            live_deleg_id=None, live_writers=[], live_paths=[], origin_wake_sid='',
            origin_ui_session_id=sid, origin_owner_transport=session['transport'],
            origin_owner_session_record=session, origin_session_history_delivery=False,
            overall_start=time.monotonic(), unit_id='cancel-before-start')
        import tools.delegate_tool as dt
        monkeypatch.setattr(dt, '_run_single_child', forbidden_direct_submit)
        dispatched = _dispatch_unit(batch, 'cancel-before-start', None,
                                    {'session_key': session['session_key'], 'origin_ui_session_id': sid})
        assert dispatched['status'] == 'dispatched'
        cancelled_event = mailbox.get(timeout=10)
        assert cancelled_event['results'][0]['status'] == 'interrupted'
        child.close.assert_called_once()
        from gateway.hosted_rooms import RoomConflictError
        with conversation_activity_scope(None, attempt), pytest.raises(RoomConflictError, match='stopped'):
            capture_conversation_delegation(session, 'late-nested-unit')
        assert route_conversation_notification(sid, session, event, 'Done')
        assert not notifications.pending('c')
        assert ad.get_durable_delegation('unit')['delivery_state'] == 'delivered'
        assert route_conversation_notification('ordinary', {}, event, 'Done') is False
    finally:
        if ad._executor:
            ad._executor.shutdown(wait=True)
        ad._reset_for_tests()
