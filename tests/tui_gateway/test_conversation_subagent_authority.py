"""Read-only reconnects retain snapshots without acquiring child control rights."""
import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_stop_recovery import registry, _child  # noqa: F401
from tests.tui_gateway.test_conversation_notifications import _setup, _settle


@pytest.mark.parametrize('method', ['subagent.interrupt', 'subagent.steer'])
def test_snapshot_attachment_requires_write_authority_for_child_control(runtime_env, monkeypatch, registry, method):
    from tui_gateway.transport import bind_transport, reset_transport
    from tools import delegate_tool_registry as children

    server, service, _, sid, session, _, attempt, _ = _setup(runtime_env, monkeypatch)
    control, _ = _child(service, sid, session, attempt, 'readonly-control', registry)
    _settle(service, attempt)
    session.pop('_hosted_room_task', None)
    session['running'] = False
    child_id = 'child-readonly-control'
    calls = []
    with children._active_subagents_lock:
        child = children._active_subagents[child_id]['agent']
        child.hard_interrupt = lambda message=None: calls.append(message)
        child.steer = lambda text: calls.append(text) or True

    class Peer:
        def __init__(self, restriction):
            self.auth_identity = {'provider': 'test', 'user_id': 'creator', **restriction}

        def write(self, frame):
            return True

    params = {'session_id': sid, 'subagent_id': child_id}
    if method == 'subagent.steer':
        params['text'] = 'Change direction'
    try:
        for restriction in ({'read_only': True}, {'role': 'viewer'}, {'scopes': ['read']}, {}):
            token = bind_transport(Peer(restriction))
            try:
                metadata = session['_conversation_binding']
                snapshot = service.runtime_snapshot('c', metadata['participant_id'], metadata['session_generation'])
                assert snapshot['available']
                assert [row['subagent_id'] for row in snapshot['subagents']] == [child_id]
                response = server._methods[method]('control', params)
                if restriction:
                    assert not calls, f'Read-only attachment mutated child: {response}'
                    assert 'error' in response or response['result'].get('status') == 'rejected'
                else:
                    assert len(calls) == 1
                    assert 'error' not in response
            finally:
                reset_transport(token)
    finally:
        control.release.set()
        assert registry[1]['readonly-control'].wait(10)
