"""Exact live session transport for a frozen conversation task; no background owner invention."""
from __future__ import annotations

import json
from contextlib import contextmanager

from gateway.hosted_room_conversation_context import TurnEnvelope
from tui_gateway.hosted_room_server_rpc import HostedRoomServerRPC
from tui_gateway.session_conversation_binding import RuntimeBinding, ConversationBindingError
from tui_gateway.transport import bind_transport, reset_transport


class ConversationTransport:
    def __init__(self, service, task):
        self.service, self.server, self.task = service, service.server, task
        self.rpc = HostedRoomServerRPC(self.server)
        self.frozen = service.store.input_for_task(task)

    def _live(self):
        frozen = self.frozen
        with self.server._sessions_lock:
            candidates = tuple(self.server._sessions.items())
        for sid, session in candidates:
            metadata = session.get('_conversation_binding') or {}
            if (metadata.get('conversation_id'), metadata.get('participant_id'), metadata.get('session_generation')) == (
                    frozen['conversation_id'], frozen['participant_id'], frozen['session_generation']):
                return sid, session, metadata
        raise ConversationBindingError('participant runtime requires its owner to reconnect')

    @contextmanager
    def _owner(self):
        sid, session, metadata = self._live()
        from tui_gateway.conversation_authority import live_owner_transport
        transport = live_owner_transport(self.server, session, metadata)
        token = bind_transport(transport)
        try:
            yield sid, session, metadata
        finally:
            reset_transport(token)

    def resolve_exact(self, **_kwargs):
        sid, _, _ = self._live()
        return {'session_id': sid}

    def create(self, **_kwargs):
        raise ConversationBindingError('only authenticated conversation admission may create a participant runtime')

    def resume(self, **_kwargs):
        return self.resolve_exact()

    def check_available(self):
        with self._owner():
            pass

    def submit_attempt(self, *, attempt, prompt, on_terminal):
        with self._owner() as (sid, session, metadata):
            runtime = RuntimeBinding(metadata['conversation_id'], metadata['participant_id'],
                metadata['session_generation'], metadata['lineage_id'], sid, metadata['profile'],
                metadata['source'], json.loads(metadata['model_snapshot']))
            def terminal(receipt):
                if 'content_ref' in receipt:
                    from gateway.hosted_room_conversation_content import ConversationContentStore
                    ConversationContentStore(self.service.db_path).validate_reference(
                        self.frozen['conversation_id'], receipt['content_ref'], text=True)
                if receipt.get('truncated'):
                    receipt = {key: value for key, value in receipt.items() if key != 'content_ref'}
                    receipt = {**receipt, 'status': 'failed', 'text': '',
                               'error': 'Full response was not retained by its source.'}
                elif len(str(receipt.get('text') or '').encode('utf-8')) > 64 * 1024:
                    from dataclasses import asdict
                    from gateway.hosted_room_conversation_content import ConversationContentStore, ContentQuotaError
                    try:
                        ref = ConversationContentStore(self.service.db_path).put_for_conversation(
                            self.frozen['conversation_id'], receipt['text'].encode('utf-8'),
                            'text/plain; charset=utf-8')
                        receipt = {**receipt, 'text': '', 'content_ref': asdict(ref)}
                    except ContentQuotaError as exc:
                        receipt = {**receipt, 'status': 'failed', 'text': '', 'error': str(exc)}
                on_terminal(receipt)
            from .conversation_attachments import ConversationAttachments
            attachments = ConversationAttachments(self.service)
            images = attachments.stage_images(self.frozen)
            return self.rpc.submit_conversation(runtime=runtime, attempt=attempt, prompt=prompt,
                                                image_paths=tuple(images), on_terminal=terminal)

    def history(self, **_kwargs):
        # Profile transcript is not a proof that an arbitrary execution generation completed.
        return ()

    def info(self, **_kwargs):
        with self._owner() as (sid, session, metadata):
            repair_input_ack(self.service.store, session, self.frozen)
            return self.rpc.info(profile=metadata['profile'], session_id=sid, source=metadata['source'])

    def interrupt(self, *, expected_task_id, **_kwargs):
        with self._owner() as (sid, session, metadata):
            self.rpc.interrupt(profile=metadata['profile'], session_id=sid,
                               source=metadata['source'], expected_task_id=expected_task_id)
            # The ordinary RPC acknowledges the request; confirmation waits for the run's finally.
            with session['history_lock']:
                confirmed = not session.get('running')
            return {'status': 'interrupted' if confirmed else 'requested', 'interrupted': confirmed}


def input_identity(frozen):
    from agent.conversation_input import ManagedConversationInput
    envelope = TurnEnvelope(**json.loads(frozen['envelope_json']))
    return ManagedConversationInput(frozen['input_id'], envelope.input_digest,
        frozen['conversation_id'], frozen['participant_id'], frozen['session_generation']), envelope


def ack_receipt(store, frozen, receipt):
    _, envelope = input_identity(frozen)
    store.ack_input(frozen['conversation_id'], frozen['participant_id'], frozen['session_generation'],
                    receipt, tuple(envelope.source_event_ids), envelope.through_seq)


def repair_input_ack(store, session, frozen):
    identity, _ = input_identity(frozen)
    agent = session.get('agent')
    db = getattr(agent, '_session_db', None)
    if db is None:
        return False
    receipt = db.recover_conversation_input_receipt(agent.session_id, **vars(identity))
    if receipt:
        ack_receipt(store, frozen, receipt)
    return receipt is not None


@contextmanager
def conversation_input_scope(server, session, agent):
    """Bridge the validated in-process task proof into the canonical agent input flush."""
    if not session.get('_conversation_binding'):
        yield
        return
    from agent.conversation_input import managed_conversation_input, ConversationInputRecoveryRequired
    from gateway.hosted_room_conversation_store import ConversationStore
    from gateway import hosted_room_driver as driver
    attempt = session.get('_conversation_attempt')
    if not isinstance(attempt, driver.TaskAttempt):
        raise ConversationBindingError('conversation input has no trusted task attempt')
    store = ConversationStore(server._conversation_db_path)
    frozen = store.input_for_task({'identity': attempt.identity})
    identity, _ = input_identity(frozen)
    try:
        with managed_conversation_input(agent, identity, on_persisted=lambda receipt: ack_receipt(store, frozen, receipt)):
            yield
    except ConversationInputRecoveryRequired as exc:
        ack_receipt(store, frozen, exc.receipt)
        raise
