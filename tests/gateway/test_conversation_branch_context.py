"""Inherited public authorship does not imply private coverage in a fresh branch."""

import pytest

from gateway import hosted_room_driver, hosted_rooms
from gateway.hosted_room_conversation_context import build_turn_envelope
from gateway.hosted_room_conversation_history import ConversationHistoryStore
from gateway.hosted_room_conversation_owners import LOCAL_OWNER
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission
from hermes_state import SessionDB


@pytest.mark.parametrize('operation', ['branch', 'edit', 'nested'])
def test_inherited_response_is_bridged_until_child_durably_receives_it(tmp_path, monkeypatch, operation):
    monkeypatch.setattr(hosted_rooms, 'local_authority_gateway_id', lambda: 'host')
    store = ConversationStore(tmp_path / 'shared-state.db')
    hosted_room_driver._connect(store.db_path).close()
    general = ParticipantRef('general', 'host', 'default', 'Aino', True)
    store.create('source', 'Source', general, None, owner_key=LOCAL_OWNER)
    admitted = store.append_input('source', TurnSubmission('turn', 'input', 'general', 'question'))
    room = hosted_rooms.room_state(store.db_path, room_id='source', purpose='conversation')
    response = hosted_rooms.append_event(
        store.db_path, room_id='source', purpose='conversation', event_id='answer',
        kind='conversation.response', actor={'kind': 'participant', 'id': 'general', 'display_name': 'Aino'},
        payload={'text': 'Only in inherited response', 'session_generation': 1, 'status': 'settled',
                 'reply_to_event_id': admitted.event_id},
        authority_gateway_id=room['authority_gateway_id'], authority_epoch=room['authority_epoch'])
    source_binding = store.participants('source')[0]
    assert response['event_id'] in store.context_coverage(source_binding).own_event_ids
    history_store = ConversationHistoryStore(store)
    selected = response['event_id']
    if operation == 'edit':
        selected = store.append_input('source', TurnSubmission('later', 'later', 'general', 'Original')).event_id
    original_events = store.events('source').events
    history_store.branch(
        owner_key=LOCAL_OWNER, conversation_id='source', source_event_id=selected,
        expected_revision=store.get('source').revision, target_conversation_id='child',
        operation_id='branch', edit_text='Edited' if operation == 'edit' else None)
    target = 'child'
    if operation == 'nested':
        history_store.branch(
            owner_key=LOCAL_OWNER, conversation_id='child', source_event_id=response['event_id'],
            expected_revision=store.get('child').revision, target_conversation_id='grandchild', operation_id='nested')
        target = 'grandchild'
    binding = store.participants(target)[0]
    assert binding.lineage_id is None and binding.session_generation == source_binding.session_generation
    _, history, coverage = store.context_snapshot(binding, response['seq'])
    request = TurnSubmission('next', 'next', 'general', 'continue')
    envelope = build_turn_envelope(binding=binding, project=None, request=request, history=history,
                                  coverage=coverage, input_cutoff=response['seq'], budget_bytes=48000)
    assert response['event_id'] not in coverage.own_event_ids
    assert 'Only in inherited response' in envelope.text
    assert response['event_id'] in envelope.source_event_ids
    store.append_input(target, request)
    store.prepare_input(binding, request.input_id, envelope)
    with SessionDB(tmp_path / 'profile-state.db') as db:
        db.create_session('child-private', source='desktop')
        receipt = db.accept_conversation_input(
            'child-private', input_id=request.input_id, input_digest=envelope.input_digest,
            message={'role': 'user', 'content': envelope.text}, conversation_id=target,
            participant_id='general', session_generation=binding.session_generation)
        store.ack_input(target, 'general', binding.session_generation, receipt,
                        envelope.source_event_ids, envelope.through_seq)
    covered = store.context_coverage(binding)
    assert response['event_id'] in covered.received_event_ids
    assert response['event_id'] not in covered.own_event_ids
    assert store.events('source').events == original_events
    assert next(event for event in store.events(target).events if event['event_id'] == response['event_id'])['payload'] == response['payload']
