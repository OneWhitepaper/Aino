"""History actions share the canonical owner, preparation, and turn admission path."""
from gateway.hosted_room_conversation_maintenance import managed_call
from gateway.hosted_room_conversation_history import ConversationHistoryStore
from gateway.hosted_room_conversation_reactions import ConversationReactions
from tui_gateway.session_conversation_binding import ConversationBindingError


@managed_call
def branch(service, **params):
    with service._lock:
        owner = service._authorize(params['conversation_id'], write=True)
        if not service.capabilities()['enabled']:
            raise ConversationBindingError('Multi-agent conversations are not enabled on this gateway.')
        receipt = ConversationHistoryStore(service.store).branch(owner_key=owner, **params)
        return {'conversation': service._public_record(service.store.get(receipt['conversation_id'])), 'branch': receipt}


@managed_call
def regenerate(service, **params):
    with service._lock:
        owner = service._authorize(params['conversation_id'], write=True)
        action = ConversationHistoryStore(service.store).regeneration(owner_key=owner, **params)
        if 'admission' in action:
            return {**action, 'regenerates_event_id': params['source_event_id']}
        submission = action['submission']
        binding = next(b for b in service.store.participants(params['conversation_id'])
                       if b.participant.participant_id == submission['participant_id'])
        prepared = service.prepare(params['conversation_id'],submission['participant_id'],
            expected_generation=binding.session_generation,expected_revision=params['expected_revision'])
        token = None
        if action['command']:
            from tui_gateway.conversation_commands import ConversationCommands
            command = ConversationCommands(service).execute(params['conversation_id'],submission['participant_id'],
                binding.session_generation,prepared['conversation_revision'],submission['text'])
            if command['type'] != 'send':
                raise ConversationBindingError('original command is no longer a send command')
            token = command['command_token']
        result = service.send(params['conversation_id'], **submission,
            expected_revision=prepared['conversation_revision'],command_token=token)
        return {**result,'regenerates_event_id':params['source_event_id']}


@managed_call
def react(service, **params):
    owner = service._authorize(params['conversation_id'], write=True)
    return {'reaction': ConversationReactions(service.db_path).set(owner_key=owner, **params)}


@managed_call
def reactions(service, **params):
    owner = service._authorize(params['conversation_id'])
    return {'reactions': ConversationReactions(service.db_path).read(owner_key=owner, **params)}


@managed_call
def cancel_draft(service, **params):
    with service._lock:
        owner=service._authorize(params['conversation_id'],write=True)
        ConversationHistoryStore(service.store).cancel_draft(owner_key=owner,**params)
        return {'conversation':service._public_record(service.store.get(params['conversation_id']))}
