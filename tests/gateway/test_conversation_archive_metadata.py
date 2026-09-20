"""Archive preserves every page; title authority follows only public user input."""
import pytest
from gateway import hosted_rooms, hosted_room_driver as driver
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission
from gateway.hosted_room_conversation_context import TurnEnvelope
from gateway.hosted_room_conversation_admission import ConversationBusyError


def read_all(store, cid):
    events, cursor = [], 0
    while True:
        page = store.events(cid, cursor, 2)
        events.extend(page.events)
        if not page.has_more:
            return events
        assert page.cursor > cursor
        cursor = page.cursor


def test_archive_preserves_pages_requires_owner_revision_and_idle_state(tmp_path):
    store = ConversationStore(tmp_path / 'shared-state.db')
    general = ParticipantRef('g', 'install', 'default', 'Aino', True)
    created = store.create('c', 'Title', general, None, owner_key='owner')
    for i in range(7):
        store.append_input('c', TurnSubmission(f't{i}', f'i{i}', 'g', f'Public request {i}'))
    before = read_all(store, 'c')
    current = store.get('c')
    with pytest.raises(hosted_rooms.HostedRoomError):
        store.archive('c', current.revision, owner_key='foreign')
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.archive('c', created.revision, owner_key='owner')
    archived = store.archive('c', current.revision, owner_key='owner')
    assert archived.archived and read_all(store, 'c') == before
    assert not store.list_conversations()[0]
    assert store.list_conversations(include_archived=True)[0] == (archived,)
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.append_input('c', TurnSubmission('late', 'late', 'g', 'No admission'))
    assert read_all(store, 'c') == before
    busy = store.create('busy', 'Busy', general, None)
    driver._connect(store.db_path).close()
    binding = store.participants('busy')[0]
    store.admit_turn(binding, TurnSubmission('t', 'i', 'g', 'Work'), TurnEnvelope('Work', 'd', (), 0, 0),
                     expected_revision=busy.revision, input_cutoff=0)
    with pytest.raises(ConversationBusyError):
        store.archive('busy', store.get('busy').revision)


def test_title_derives_once_from_public_input_and_manual_title_wins(tmp_path):
    from agent.title_generator import derive_title
    from gateway.hosted_room_conversation_metadata import derive_first_public_title
    store = ConversationStore(tmp_path / 'shared-state.db')
    general = ParticipantRef('g', 'install', 'default', 'Aino', True)
    store.create('auto', 'New conversation', general, None, auto_title=True, owner_key='owner')
    first = 'Build a quiet garden\nPrivate execution context is never passed here'
    store.append_input('auto', TurnSubmission('t', 'i', 'g', first))
    assert store.get('auto').title == derive_title(first)
    revision = store.get('auto').revision
    renamed = store.rename('auto', 'My garden', revision, owner_key='owner')
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.rename('auto', 'Stale', revision, owner_key='owner')
    store.append_input('auto', TurnSubmission('t2', 'i2', 'g', 'A different topic'))
    assert store.get('auto').title == renamed.title
    draft = store.create('draft', 'New conversation', general, None, auto_title=True)
    store.rename('draft', 'Chosen before sending', draft.revision)
    with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
        derive_first_public_title(conn, 'draft', 'Delayed generated title')
    store.append_input('draft', TurnSubmission('t', 'i', 'g', 'Public opening'))
    assert store.get('draft').title == 'Chosen before sending'
    store.create('explicit', 'User provided', general, None)
    store.append_input('explicit', TurnSubmission('t', 'i', 'g', 'First message'))
    assert store.get('explicit').title == 'User provided'
