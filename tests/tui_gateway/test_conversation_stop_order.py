"""Stop must signal the real participant before releasing its human-request wait."""
import threading
from contextlib import nullcontext
from dataclasses import asdict
from types import SimpleNamespace

from tests.tui_gateway.test_conversation_session_binding import runtime_env
from tests.tui_gateway.test_conversation_notifications import _setup


def test_stop_signals_participant_before_clarification_waiter_resumes(runtime_env, monkeypatch):
    from gateway import hosted_room_driver as driver
    from tui_gateway import server_requests
    from tui_gateway.conversation_activity import ConversationActivity
    from tui_gateway.hosted_room_driver import HostedRoomRuntime
    from tui_gateway.hosted_room_server_rpc import HostedRoomServerRPC
    server, service, _, sid, session, lease, attempt, _ = _setup(runtime_env, monkeypatch)
    binding = service.bindings()[0]
    runtime = HostedRoomRuntime(db_path=service.db_path, rooms=[binding], rpc=HostedRoomServerRPC(server),
        transport_resolver=service.transport, turn_lock=lambda _: nullcontext(),
        process_generation=lease.process_generation, lease_ttl_seconds=300)
    service.hosted = SimpleNamespace(runtime=runtime, wakeup=lambda: None)
    session['running'] = True
    session['_hosted_room_task'] = {'room_id': 'c', 'task_id': attempt.identity.task_id,
        'thread_id': attempt.identity.thread_id, 'turn_id': attempt.identity.turn_id,
        'execution_generation': attempt.execution_generation,
        'member_id': session['_conversation_binding']['participant_id']}
    origin = ConversationActivity('c', attempt.identity.turn_id,
        session['_conversation_binding']['participant_id'], 1, attempt.identity.task_id,
        attempt.execution_generation, sid)
    registered, observed = threading.Event(), threading.Event()
    observations = []
    def write(frame):
        req = server_requests._open[frame['id']]
        release = req.event.set
        def barrier():
            release()
            assert observed.wait(5), 'request waiter did not resume'
        req.event.set = barrier
        registered.set()
    monkeypatch.setattr(server_requests, '_write', write)
    monkeypatch.setattr(server_requests, '_emit', lambda *a, **kw: None)
    def waiter():
        try:
            server_requests.send('clarify', sid, {'question': 'Choose?', 'choices': ['Yes'],
                                                'conversation': asdict(origin)}, timeout=10)
            observations.append((bool(session.get('_turn_cancel_requested')),
                                 driver.get_task(service.db_path, attempt.identity)['status']))
        finally:
            with session['history_lock']:
                session['running'] = False
            observed.set()
    worker = threading.Thread(target=waiter)
    session['_run_thread'] = worker
    worker.start()
    try:
        assert registered.wait(5)
        service.stop('c', attempt.identity.turn_id, attempt.execution_generation)
        worker.join(5)
        assert not worker.is_alive()
        assert observations == [(True, 'stopping')]
    finally:
        server_requests.cancel(sid)
        worker.join(5)
