"""Restored task evidence cannot replay old paths or credentials through Retry."""
import json

from gateway import hosted_rooms
from tests.tui_gateway.test_conversation_session_binding import runtime_env
from tests.tui_gateway.test_conversation_notifications import _setup
from tests.tui_gateway.test_conversation_authority import Peer, caller


def test_restored_indeterminate_task_requires_owner_stop_instead_of_retry(runtime_env, monkeypatch):
    import pytest
    from gateway.hosted_room_conversation_owners import ConversationOwnershipError
    from tui_gateway.session_conversation_binding import ConversationBindingError
    server, service, _, _, _, _, attempt, _ = _setup(runtime_env, monkeypatch)
    with hosted_rooms._transaction(service.db_path, immediate=True) as conn:
        conn.execute("UPDATE hosted_room_driver_tasks SET status='indeterminate',result_json=?,run_gateway_id=NULL,run_process_generation=NULL,run_lease_generation=NULL WHERE room_id='c'",
                     (json.dumps({'error': 'restored_snapshot_requires_stop'}),))
    with caller(Peer('stranger')):
        with pytest.raises(ConversationOwnershipError):
            service.retry('c', 'origin', 'input-origin', attempt.execution_generation)
    with pytest.raises(ConversationBindingError, match='must be stopped'):
        service.retry('c', 'origin', 'input-origin', attempt.execution_generation)
    assert service.stop('c', 'origin', attempt.execution_generation)['status'] == 'confirmed'
    assert service._tasks('c')[0]['status'] == 'cancelled'

    assert service.get('c')['active_turn'] is None


def test_restore_marker_with_live_run_fence_does_not_claim_stop_complete(runtime_env, monkeypatch):
    server, service, _, _, _, _, attempt, _ = _setup(runtime_env, monkeypatch)
    with hosted_rooms._transaction(service.db_path, immediate=True) as conn:
        conn.execute("UPDATE hosted_room_driver_tasks SET status='indeterminate',result_json=? WHERE room_id='c'",
                     (json.dumps({'error': 'restored_snapshot_requires_stop'}),))
    assert service.stop('c', 'origin', attempt.execution_generation)['status'] == 'requested'
    assert service._tasks('c')[0]['status'] == 'stopping'
