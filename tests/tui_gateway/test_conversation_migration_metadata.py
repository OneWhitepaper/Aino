"""Metadata edits cannot change the immutable target while adoption must still retry."""
import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_migration import _source
from tui_gateway.conversation_migration import adopt_session
from gateway import hosted_rooms
from gateway.hosted_room_conversation_migration import ConversationMigrationStore


class InterruptedProcess(BaseException):
    pass


@pytest.mark.parametrize('error_type', [RuntimeError, InterruptedProcess])
def test_metadata_waits_for_failed_or_interrupted_adoption_then_remains_available(runtime_env, monkeypatch, error_type):
    server, service, db, _ = _source(runtime_env, monkeypatch)
    params = dict(source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='once')
    original = ConversationMigrationStore.import_row
    count = 0
    def interrupt(self, *args):
        nonlocal count
        count += 1
        if count == 2:
            raise error_type('interrupted import')
        return original(self, *args)
    monkeypatch.setattr(ConversationMigrationStore, 'import_row', interrupt)
    try:
        with pytest.raises(error_type, match='interrupted import'):
            adopt_session(server, **params)
        before = service.store.get('adopted')
        for change in (lambda: service.rename('adopted', 'Changed too early', before.revision),
                       lambda: service.archive('adopted', before.revision)):
            with pytest.raises(hosted_rooms.RoomConflictError, match='migration is not complete'):
                change()
            assert service.store.get('adopted') == before
        monkeypatch.setattr(ConversationMigrationStore, 'import_row', original)
        assert adopt_session(server, **params)['status'] == 'complete'
        renamed = service.rename('adopted', 'My adopted work', service.store.get('adopted').revision)['conversation']
        assert renamed['title'] == 'My adopted work'
        events = service.events('adopted')
        assert service.archive('adopted', renamed['revision'])['conversation']['archived']
        assert service.events('adopted') == events
    finally:
        db.close()
