"""Specified-recipient plans reuse the existing fenced Hosted driver contract."""

from dataclasses import replace

import pytest

from gateway import hosted_room_driver as driver
from gateway.hosted_room_conversation_context import TurnEnvelope
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission


def test_plan_preserves_admitted_recipient_and_uses_existing_driver_payload(tmp_path):
    from gateway.hosted_room_conversation import plan_conversation_turn

    store = ConversationStore(tmp_path / "shared-state.db")
    general = ParticipantRef("general", "host", "default", "Aino", True)
    record = store.create("c1", "Novel", general, None)
    binding = store.bind_participant("c1", ParticipantRef("writer", "host", "writer", "Writer"))
    request = TurnSubmission("t1", "i1", "writer", "Write a scene")
    admission = store.append_input("c1", request)
    envelope = TurnEnvelope("Attributed user request", "digest", (), 0, 0)
    plan = plan_conversation_turn(record, binding, request, admission, envelope)
    replay = plan_conversation_turn(record, binding, request, replace(admission, idempotent=True), envelope)
    assert plan.identity == replay.identity
    assert plan.identity.turn_id == request.turn_id
    assert plan.payload["target_profile"] == "writer"
    assert plan.payload["target_member_id"] == "writer"
    assert plan.payload["prompt"] == envelope.text
    stored = driver.admit_task(store.db_path, plan.identity, payload=plan.payload, clock=lambda: 1.0)
    assert stored["payload"] == plan.payload
    with pytest.raises(ValueError):
        plan_conversation_turn(record, binding, replace(request, participant_id="general"), admission, envelope)
    with pytest.raises(ValueError):
        plan_conversation_turn(record, binding, request, replace(admission, conversation_id="other"), envelope)


@pytest.mark.parametrize('oversized,truncated', [(False, False), (True, False), (False, True), (True, True)])
def test_terminal_publishes_once_per_execution_without_preview_claim(tmp_path, oversized, truncated):
    import time
    from tui_gateway.hosted_room_driver import HostedRoomBinding
    from gateway.hosted_room_conversation import plan_conversation_turn, publish_conversation_terminal
    from gateway import hosted_rooms
    store = ConversationStore(tmp_path / 'shared-state.db')
    driver._connect(store.db_path).close()
    general = ParticipantRef('general', hosted_rooms.local_authority_gateway_id(), 'default', 'Aino', True)
    record = store.create('c', 'Work', general, None)
    binding = store.bind_participant('c', general)
    request = TurnSubmission('t', 'i', 'general', 'Hello')
    admission = store.append_input('c', request)
    envelope = TurnEnvelope('Hello', 'digest', (), 0, 0)
    store.prepare_input(binding, 'i', envelope)
    plan = plan_conversation_turn(record, binding, request, admission, envelope)
    task = driver.admit_task(store.db_path, plan.identity, payload=plan.payload, clock=time.time)
    room = hosted_rooms.room_state(store.db_path, room_id='c', purpose='conversation')
    runtime_binding = HostedRoomBinding('c', room['authority_gateway_id'], room['authority_epoch'])
    lease = driver.acquire_lease(store.db_path, room_id='c', gateway_id=runtime_binding.gateway_id,
        authority_epoch=runtime_binding.authority_epoch, process_generation='process',
        ttl_seconds=30, clock=time.time)
    attempt = driver.start_task(store.db_path, plan.identity, lease, expected_cancel_generation=0, clock=time.time)
    with pytest.raises(driver.StaleTaskError):
        driver.begin_task_cancel(store.db_path, plan.identity, cancel_id='stale-stop',
            expected_cancel_generation=0, expected_execution_generation=0, clock=time.time)
    assert driver.get_task(store.db_path, plan.identity)['status'] == 'running'
    answer = '世' * 24000 if oversized else 'Complete answer'
    from contextlib import nullcontext
    from types import SimpleNamespace
    from tui_gateway.conversation_transport import ConversationTransport
    from tui_gateway.hosted_room_driver import HostedRoomRuntime, _bounded_terminal_result
    transport = ConversationTransport.__new__(ConversationTransport)
    transport.service = SimpleNamespace(db_path=store.db_path)
    transport.frozen = store.input_for_task(task)
    metadata = dict(conversation_id='c', participant_id='general', session_generation=1,
                    lineage_id=None, profile='default', source='gui', model_snapshot='{}')
    import threading
    transport._owner = lambda: nullcontext(('session', {'history_lock': threading.RLock()}, metadata))
    transport.rpc = SimpleNamespace(submit_conversation=lambda **kwargs:
        kwargs['on_terminal']({'status': 'settled', 'text': answer, 'truncated': truncated}))
    worker = HostedRoomRuntime(db_path=store.db_path, rooms=[runtime_binding],
        turn_lock=lambda _: nullcontext(), rpc=SimpleNamespace(),
        publish_terminal=lambda binding, task: publish_conversation_terminal(store, binding, task))
    from dataclasses import asdict
    from gateway.hosted_room_conversation_content import ConversationContentStore
    reference = asdict(ConversationContentStore(store.db_path).put_for_conversation(
        'c', b'canonical bytes', 'text/plain; charset=utf-8'))
    for invalid in ({}, None, {**reference, 'sha256': 'forged'},
                    {**reference, 'size_bytes': -1}, {**reference, 'mime_type': 'image/png'}):
        with pytest.raises(ValueError):
            worker._on_terminal(runtime_binding, attempt,
                                {'status': 'settled', 'text': '', 'content_ref': invalid})
        assert driver.get_task(store.db_path, plan.identity)['status'] == 'running'
        assert not [event for event in store.events('c').events if event['kind'] == 'conversation.response']
    transport.submit_attempt(attempt=attempt, prompt='Hello',
        on_terminal=lambda receipt: worker._on_terminal(runtime_binding, attempt, receipt))
    task = driver.get_task(store.db_path, plan.identity)
    if oversized:
        assert _bounded_terminal_result({'text': answer})['truncated'] is True
    first = publish_conversation_terminal(store, runtime_binding, task)
    second = publish_conversation_terminal(store, runtime_binding, task)
    assert first['event_id'] == second['event_id']
    payload = first['payload']
    assert payload['reply_to_event_id'] == admission.event_id
    assert payload['session_generation'] == binding.session_generation
    if truncated:
        assert payload['text'] == '' and payload['status'] == 'failed'
        assert payload['content_status'] == 'unsupported'
        assert 'content_ref' not in payload
        assert store.public_history('c', first['seq'])[-1].text == ''
    elif oversized:
        assert payload['text'] == '' and payload['status'] == 'settled'
        assert payload['content_status'] == 'referenced'
        from gateway.hosted_room_conversation_content import ConversationContentStore
        assert ConversationContentStore(store.db_path).read_for_conversation(
            'c', payload['content_ref']['id']).decode() == answer
        assert store.public_history('c', first['seq'])[-1].text == answer
    else:
        assert payload['text'] == answer and payload['status'] == 'settled'
