"""Aino wire sidecars survive the canonical worker's owner transaction."""
import pytest

from agent.runtime_session_store import RuntimeSessionStore, WorkerPersistenceError
from hermes_state import SessionDB
from hermes_state_runtime import begin_runtime_epoch, mutate_worker_execution, register_worker_execution


@pytest.mark.parametrize('addressed', [True, False])
def test_worker_backfills_native_sidecars_and_mode_metadata(tmp_path, addressed):
    db = SessionDB(tmp_path / 'state.db')
    try:
        db.create_session('owned', 'cli')
        db.create_session('foreign', 'cli')
        db.append_messages_batch('owned', [{'role': 'user', 'content': 'again'},
                                          {'role': 'user', 'content': 'again'}])
        foreign_row = db.append_message('foreign', 'user', content='again')
        epoch = begin_runtime_epoch(db, instance_id='fixture')
        scope = dict(epoch=epoch, execution_id='worker', session_id='owned', generation=0)
        register_worker_execution(db, **scope, kind='compute', adoption_secret='secret')
        store = RuntimeSessionStore(lambda method, **p: mutate_worker_execution(db, **p), scope, tmp_path / 'outbox')
        try:
            latest = store.latest_message_row_id('owned')
            older = store.latest_message_row_id('owned', offset=1)
            assert latest == db.latest_message_row_id('owned')
            assert older != latest
            sidecar = [{'type': 'text', 'text': 'again with mode note'}]
            metadata = {'aino.ultra_collaboration_active': True}
            if addressed:
                assert store.set_message_api_content('owned', latest, 'again', sidecar,
                                                     display_metadata=metadata) == 1
                assert store.set_message_api_content('owned', foreign_row, 'again', sidecar) == 0
                assert store.set_message_api_content('owned', latest, 'different', sidecar) == 0
            else:
                assert store.set_latest_user_api_content('owned', 'again', sidecar,
                                                         display_metadata=metadata) == 1
            rows = db.get_messages('owned')
            assert rows[0]['api_content'] is None
            assert rows[1]['api_content'] == sidecar
            assert rows[1]['display_metadata'] == metadata
            assert store.set_message_api_content('owned', latest, 'again', None) == 1
            assert db.get_messages('owned')[1]['api_content'] is None
            assert db.get_messages('owned')[1]['display_metadata'] == metadata
            with pytest.raises(WorkerPersistenceError, match='permission_denied'):
                store.latest_message_row_id('foreign')
        finally:
            store.close()
    finally:
        db.close()
