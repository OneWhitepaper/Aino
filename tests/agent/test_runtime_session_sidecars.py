"""Aino wire sidecars survive the canonical worker's owner transaction."""



from persistence.conversation.messages import NewMessage
from persistence_assembly import open_persistence, profile_scope
from tests.fixtures.storage_seed import seed_messages
from tests.fixtures.storage_seed import seed_session
from tests.fixtures.storage_read import transcript_rows
import pytest

from agent.runtime_session_store import RuntimeSessionStore, WorkerPersistenceError


@pytest.mark.parametrize('addressed', [True, False])
def test_worker_backfills_native_sidecars_and_mode_metadata(tmp_path, addressed):
    db = open_persistence(profile_scope(home=(tmp_path / 'state.db').parent))
    try:
        seed_session(db, 'owned', 'cli')
        seed_session(db, 'foreign', 'cli')
        seed_messages(db, 'owned', *[{'role': 'user', 'content': 'again'},
                                          {'role': 'user', 'content': 'again'}])
        foreign_row = db.messages.append('foreign', NewMessage('user', content='again'))
        epoch = db.runtime.begin_epoch(instance_id='fixture')
        scope = dict(epoch=epoch, execution_id='worker', session_id='owned', generation=0)
        db.worker_executions.register(**scope, kind='compute', adoption_secret='secret')
        store = RuntimeSessionStore(lambda method, **p: db.worker_executions.persist_operation(**p), scope, tmp_path / 'outbox')
        try:
            latest = store.latest_message_row_id('owned')
            older = store.latest_message_row_id('owned', offset=1)
            assert latest == db.messages.latest_row_id('owned')
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
            rows = transcript_rows(db, 'owned')
            assert rows[0]['api_content'] is None
            assert rows[1]['api_content'] == sidecar
            assert rows[1]['display_metadata'] == metadata
            assert store.set_message_api_content('owned', latest, 'again', None) == 1
            assert transcript_rows(db, 'owned')[1]['api_content'] is None
            assert transcript_rows(db, 'owned')[1]['display_metadata'] == metadata
            with pytest.raises(WorkerPersistenceError, match='permission_denied'):
                store.latest_message_row_id('foreign')
        finally:
            store.close()
    finally:
        db.close()
