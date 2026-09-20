"""Specified-recipient policy for ordinary Hosted conversations."""

from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_call

import hashlib

from gateway.hosted_room_conversation_context import TurnEnvelope
from gateway.hosted_room_conversation_types import (
    Admission, ConversationRecord, ConversationTurnPlan, ParticipantBinding, TurnSubmission,
)
from gateway.hosted_room_driver import TaskIdentity


def plan_conversation_turn(
    record: ConversationRecord, binding: ParticipantBinding, submission: TurnSubmission,
    admission: Admission, envelope: TurnEnvelope,
) -> ConversationTurnPlan:
    """A selection identifies a depth-zero responder; it never merges Profile capabilities."""
    if not (record.conversation_id == binding.conversation_id == admission.conversation_id):
        raise ValueError("conversation identity differs across turn records")
    if not (binding.participant.participant_id == submission.participant_id == admission.participant_id):
        raise ValueError("admitted recipient differs from the bound participant")
    if (submission.input_id, submission.turn_id) != (admission.input_id, admission.turn_id):
        raise ValueError("submission differs from the admitted input")
    if envelope.through_seq >= admission.seq:
        raise ValueError("input history must end before this admitted user event")
    task_id = "conversation:" + hashlib.sha256(submission.input_id.encode("utf-8")).hexdigest()
    return ConversationTurnPlan(
        identity=TaskIdentity(record.conversation_id, task_id, "main", submission.turn_id),
        payload={
            "target_profile": binding.participant.profile,
            "target_member_id": binding.participant.participant_id,
            "prompt": envelope.text,
            "source_event_seq": admission.seq,
        },
        binding=binding,
        envelope=envelope,
    )


@managed_call
def publish_conversation_terminal(store, binding, task):
    """A single stable event per task execution; never publish a bounded preview as the answer."""
    from gateway import hosted_rooms
    if task['status'] not in ('settled', 'failed', 'cancelled'):
        return
    event_id = f"conversation-terminal:{task['identity'].task_id}:{task['execution_generation']}"
    # Published answers are immutable, including legacy answers without model metadata.
    with hosted_rooms._transaction(store.db_path) as conn:
        existing = hosted_rooms._load_event(conn, binding.room_id, event_id)
        if existing is not None:
            return hosted_rooms._event_from_row(existing, idempotent=True)
    frozen = store.input_for_task(task)
    result = task.get('result') or {}
    text = str(result.get('text') or '')
    from dataclasses import asdict
    from gateway.hosted_room_conversation_content import ConversationContentStore
    content_ref = result.get('content_ref')
    content = ConversationContentStore(store.db_path)
    unsupported = bool(result.get('truncated'))
    if 'content_ref' in result:
        content_ref = asdict(content.validate_reference(binding.room_id, content_ref, text=True))
        text = ''
    elif not unsupported and len(text.encode('utf-8')) > 64 * 1024:
        content_ref = asdict(content.put_for_conversation(
            binding.room_id, text.encode('utf-8'), 'text/plain; charset=utf-8', input_id=frozen['input_id']))
        text = ''
    if unsupported:
        text = ''
        content_ref = None
    status = 'failed' if unsupported else task['status']
    error = 'Full response was not retained by its source.' if unsupported else result.get('error')
    from gateway.hosted_room_conversation_bindings import ConversationBindings
    model_snapshot = ConversationBindings(store.db_path).public_model_snapshot(
        binding.room_id, frozen['participant_id'], frozen['session_generation'])
    from gateway.hosted_room_conversation_history import terminal_relation
    relation = terminal_relation(store, binding.room_id, frozen['input_id'])
    participant = next(b.participant for b in store.participants(binding.room_id)
                       if b.participant.participant_id == frozen['participant_id'])
    return hosted_rooms.append_event(store.db_path, room_id=binding.room_id, purpose='conversation',
        event_id=event_id,
        kind='conversation.response', actor={'kind': 'participant', 'id': participant.participant_id,
                                            'display_name': participant.display_name},
        payload={**relation, 'text': text, 'status': status, 'error': error, 'model_snapshot': model_snapshot,
                 'turn_id': frozen['turn_id'], 'input_id': frozen['input_id'],
                 'task_id': task['identity'].task_id, 'execution_generation': task['execution_generation'],
                 'session_generation': frozen['session_generation'], 'reply_to_event_id': frozen['event_id'],
                 'author_display_name_at_time': participant.display_name,
                 'content_status': 'unsupported' if unsupported else ('referenced' if content_ref else 'complete'),
                 **({'content_ref': content_ref} if content_ref else {})},
        authority_gateway_id=binding.gateway_id, authority_epoch=binding.authority_epoch)
