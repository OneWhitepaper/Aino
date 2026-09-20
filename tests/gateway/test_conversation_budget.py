"""Actual admission reserves reply capacity and rejects drafts without durable side effects."""
import pytest
from types import SimpleNamespace
from gateway import hosted_rooms, hosted_room_driver as driver
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission
from gateway.hosted_room_conversation_context import TurnEnvelope
from gateway.hosted_room_conversation_content import ConversationContentStore, ContentQuotaError


def test_capacity_and_disk_refuse_before_input_and_reserve_concurrent_reply(tmp_path, monkeypatch):
    from gateway import hosted_room_conversation_budget as budget
    store = ConversationStore(tmp_path / 'shared-state.db')
    driver._connect(store.db_path).close()
    general = ParticipantRef('g', 'install', 'default', 'Aino', True)
    config = tmp_path / 'config.yaml'
    config.write_text('conversations:\n  storage:\n    max_content_bytes: 100000\n    max_total_bytes: 450000\n')
    for cid in ('one', 'two'):
        store.create(cid, cid, general, None)
    def admit(cid):
        return store.admit_turn(store.participants(cid)[0], TurnSubmission('t', 'i', 'g', 'work'),
            TurnEnvelope('work', 'digest', (), 0, 0), expected_revision=store.get(cid).revision, input_cutoff=0)
    disk = budget.shutil.disk_usage
    monkeypatch.setattr(budget.shutil, 'disk_usage', lambda _: SimpleNamespace(free=0))
    with pytest.raises(ContentQuotaError):
        admit('one')
    assert not store.events('one').events and not driver.list_tasks(store.db_path, room_id='one')
    monkeypatch.setattr(budget.shutil, 'disk_usage', disk)
    admit('one')
    with pytest.raises(ContentQuotaError):
        admit('two')
    assert not store.events('two').events and not driver.list_tasks(store.db_path, room_id='two')
    text = ('完整答复' * 6000).encode()
    content = ConversationContentStore(store.db_path)
    ref = content.put_for_conversation('one', text, 'text/plain; charset=utf-8', input_id='i')
    assert content.read_for_conversation('one', ref.id) == text
    # Re-reading/re-writing a canonical response cannot repeatedly drain the reservation.
    with hosted_rooms._transaction(store.db_path) as conn:
        reserved = conn.execute('SELECT bytes FROM hosted_conversation_output_reservations').fetchone()[0]
    assert content.put_for_conversation('one', text, ref.mime_type, input_id='i') == ref
    with hosted_rooms._transaction(store.db_path) as conn:
        assert conn.execute('SELECT bytes FROM hosted_conversation_output_reservations').fetchone()[0] == reserved
    room = hosted_rooms.room_state(store.db_path, room_id='one', purpose='conversation')
    from dataclasses import asdict
    hosted_rooms.append_event(store.db_path, room_id='one', purpose='conversation', event_id='terminal',
        kind='conversation.response', actor={'kind': 'participant', 'id': 'g', 'display_name': 'Aino'},
        payload={'input_id': 'i', 'text': '', 'content_ref': asdict(ref)},
        authority_gateway_id=room['authority_gateway_id'], authority_epoch=room['authority_epoch'])
    with hosted_rooms._transaction(store.db_path) as conn:
        assert not conn.execute('SELECT 1 FROM hosted_conversation_output_reservations').fetchone()
    # Publication converts the reservation into retained content; another draft can now fit.
    admit('two')


def test_configured_active_and_event_limits_are_independent_from_discussions(tmp_path, monkeypatch):
    store = ConversationStore(tmp_path / 'shared-state.db')
    general = ParticipantRef('g', 'install', 'default', 'Aino', True)
    (tmp_path / 'config.yaml').write_text('conversations:\n  storage:\n    max_active_conversations: 1\n    max_events_per_conversation: 2\n')
    first = store.create('one', 'One', general, None)
    with pytest.raises(hosted_rooms.HostedRoomError):
        store.create('two', 'Two', general, None)
    store.archive('one', first.revision)
    store.create('two', 'Two', general, None)
    monkeypatch.setattr(hosted_rooms, 'MAX_EVENTS_PER_ROOM', 1)
    monkeypatch.setattr(hosted_rooms, 'MAX_GATEWAY_EVENT_BYTES', 1)
    for index in range(2):
        store.append_input('two', TurnSubmission(str(index), str(index), 'g', 'saved'))
    before = store.events('two')
    with pytest.raises(ContentQuotaError):
        store.append_input('two', TurnSubmission('overflow', 'overflow', 'g', 'preserve draft'))
    assert store.events('two') == before
    with hosted_rooms._transaction(store.db_path) as conn:
        assert hosted_rooms._gateway_event_bytes(conn) == 0
