"""Specified-participant policy composed with the existing Hosted room worker."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_store

import hashlib
import json
import threading
from dataclasses import asdict, replace
from pathlib import Path

from gateway import hosted_rooms, hosted_room_driver as driver
from gateway.hosted_room_conversation_admission import UNRESOLVED
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_summaries import prepare_turn_envelope
from gateway.hosted_room_conversation_types import ParticipantRef, ProjectRef, TurnSubmission
from tui_gateway.hosted_room_driver import HostedRoomBinding
from tui_gateway.conversation_authority import request_owner_key, require_conversation_owner
from tui_gateway.session_conversation_binding import (
    ConversationBindingError, resolve_conversation_session,
    _validate_environment,
)


def task_identity(conversation_id, turn_id, input_id):
    return driver.TaskIdentity(conversation_id, 'conversation:' + hashlib.sha256(input_id.encode()).hexdigest(),
                               'main', turn_id)


class _Preparation:
    """Carry the request's revision across the summary writer's own CAS increment."""
    def __init__(self, store, revision):
        self.store, self.revision = store, revision

    def context_snapshot(self, *args):
        result = self.store.context_snapshot(*args)
        if result[0].revision != self.revision:
            raise hosted_rooms.RoomConflictError('conversation changed while preparing the draft')
        return result

    def save_summary(self, *args, **kwargs):
        self.store.save_summary(*args, **kwargs)
        self.revision += 1


@managed_store
class ConversationService:
    def __init__(self, server, *, db_path: Path):
        self.server, self.db_path = server, Path(db_path)
        self.store = ConversationStore(self.db_path)
        from gateway.hosted_room_conversation_notifications import ConversationNotifications
        self.notifications = ConversationNotifications(self.store)
        self.notifications.recover_dead_origins()
        driver._connect(self.db_path).close()
        self._lock = threading.RLock()
        self.hosted = None
        server._conversation_db_path = self.db_path
        server._conversation_service = self

    def capabilities(self):
        from .conversation_commands import supported_read_commands
        from .conversation_attachments import max_attachment_bytes
        from gateway.hosted_room_conversation_store import _MAX_ATTACHMENTS
        from hermes_cli.config_effective import load_user_config_effective
        config = load_user_config_effective(self.db_path.parent / 'config.yaml')
        from hermes_cli.config_defaults import DEFAULT_CONFIG
        settings = config.get('conversations', {})
        enabled = (isinstance(settings, dict)
                   and settings.get('enabled', DEFAULT_CONFIG['conversations']['enabled']) is True)
        reason = None if enabled else 'Multi-agent conversations are not enabled on this gateway.'
        if enabled:
            from gateway.hosted_room_conversation_compat import require_compatible_backends, ConversationUpgradeRequired
            try:
                require_compatible_backends(self.db_path)
            except ConversationUpgradeRequired as exc:
                enabled, reason = False, str(exc)
        if enabled:
            try:
                # General is mandatory; an unavailable optional expert only disables
                # its catalog row. Resolve the install home even under a Profile scope.
                _validate_environment(self.server, self.db_path.parent, None,
                                      hosted_rooms.local_authority_gateway_id())
            except (ConversationBindingError, ValueError) as exc:
                enabled, reason = False, str(exc)
        return {'protocol_version': 1, 'enabled': enabled,
                'scoped_commands': True, 'supported_read_commands': supported_read_commands(),
                'max_attachment_bytes': max_attachment_bytes(self.db_path),
                'max_attachments': _MAX_ATTACHMENTS,
                'reason': reason,
                'supported_execution_environments': ['local']}

    def catalog(self):
        from hermes_cli.profiles import list_profiles
        install = hosted_rooms.local_authority_gateway_id()
        rows = []
        for profile in list_profiles():
            ref = ParticipantRef('participant:' + hashlib.sha256(
                f'{install}\0{profile.name}'.encode()).hexdigest(), install, profile.name,
                profile.display_name or ('Aino' if profile.is_default else profile.name), profile.is_default)
            try:
                _validate_environment(self.server, self.server._profile_home(profile.name), None, install)
                reason = None
            except (ConversationBindingError, ValueError) as exc:
                reason = str(exc)
            rows.append({'participant': asdict(ref), 'available': reason is None, 'reason': reason})
        return rows

    def _participant(self, participant_id):
        row = next((r for r in self.catalog() if r['participant']['participant_id'] == participant_id), None)
        if row is None or not row['available']:
            raise ConversationBindingError(row['reason'] if row else 'participant is unavailable')
        return ParticipantRef(**row['participant'])

    def _project(self, value):
        if value is None:
            return None
        from .projects_shared import SharedProjects
        project, _registered = SharedProjects(self.server).validate_source(value)
        return project

    def create(self, conversation_id, title, general_participant_id, project_ref=None, auto_title=False):
        owner = request_owner_key(self.server, write=True)
        capabilities = self.capabilities()
        if not capabilities['enabled']:
            raise ConversationBindingError(capabilities['reason'])
        general = self._participant(general_participant_id)
        if not general.is_general:
            raise ConversationBindingError('general participant must be the default assistant')
        return {'conversation': self._public_record(self.store.create(conversation_id, title, general, self._project(project_ref), owner_key=owner, auto_title=auto_title))}

    def archive(self, conversation_id, expected_revision):
        owner = self._authorize(conversation_id, write=True)
        return {'conversation': self._public_record(self.store.archive(
            conversation_id, expected_revision, owner_key=owner))}

    def rename(self, conversation_id, title, expected_revision):
        owner = self._authorize(conversation_id, write=True)
        return {'conversation': self._public_record(self.store.rename(
            conversation_id, title, expected_revision, owner_key=owner))}

    def list(self, cursor=None, limit=100, project_ref=None, include_archived=False):
        rows, cursor, more = self.store.list_conversations(cursor=cursor, limit=limit,
            project=ProjectRef(**project_ref) if project_ref else None, include_archived=include_archived,
            owner_key=request_owner_key(self.server), shared_project=True)
        return {'conversations': [self._public_record(r) for r in rows], 'cursor': cursor, 'has_more': more}

    def prepare(self, conversation_id, participant_id, expected_generation=1,
                model_source=None, model_id=None, expected_revision=None, reasoning_effort=None, fast=None):
        from tui_gateway.session_conversation_binding import prepare_conversation_session
        with self._lock:
            self._authorize(conversation_id, write=True)
            record = self.store.get(conversation_id)
            if expected_revision is not None and record.revision != expected_revision:
                raise hosted_rooms.RoomConflictError('conversation revision changed; preserve the draft')
            own_revision_delta = 0
            participant = self._participant(participant_id)
            binding = next((b for b in self.store.participants(conversation_id)
                            if b.participant.participant_id == participant_id), None)
            if binding is None:
                if expected_generation != 1:
                    raise ConversationBindingError('participant generation changed')
                binding = self.store.bind_participant(conversation_id, participant,
                    expected_revision=record.revision)
                own_revision_delta = 1
            if binding.session_generation != expected_generation:
                raise ConversationBindingError('participant generation changed')
            result = prepare_conversation_session(self.server, binding=binding, project=record.project,
                source='desktop', model_source=model_source, model_id=model_id,
                reasoning_effort=reasoning_effort, fast=fast)
            if self.hosted:
                self.hosted.wakeup()
            return {**result, 'previous_revision': record.revision,
                    'conversation_revision': record.revision + own_revision_delta}

    def _authorize(self, conversation_id, *, write=False):
        return require_conversation_owner(self.server, self.db_path, conversation_id, write=write)

    def _tasks(self, conversation_id):
        return driver.list_tasks(self.db_path, room_id=conversation_id)

    def _runtime_id(self, frozen):
        with self.server._sessions_lock:
            sessions = tuple(self.server._sessions.items())
        for sid, session in sessions:
            meta = session.get('_conversation_binding') or {}
            if (meta.get('conversation_id'), meta.get('participant_id'), meta.get('session_generation')) == (
                    frozen['conversation_id'], frozen['participant_id'], frozen['session_generation']):
                return sid
        return None

    def _public_record(self, record):
        from gateway.hosted_room_conversation_migration import migration_receipt
        from gateway.hosted_room_conversation_history import branch_receipt
        with hosted_rooms._transaction(self.db_path) as conn:
            return {**asdict(record), 'migration': migration_receipt(conn, record.conversation_id),
                    'branch': branch_receipt(conn, record.conversation_id)}

    def get(self, conversation_id):
        self._authorize(conversation_id)
        record = self.store.get(conversation_id)
        active = next((t for t in self._tasks(conversation_id) if t['status'] in UNRESOLVED), None)
        turn = None
        if active:
            frozen = self.store.input_for_task(active)
            turn = {'turn_id': frozen['turn_id'], 'input_id': frozen['input_id'],
                    'participant_id': frozen['participant_id'], 'session_generation': frozen['session_generation'],
                    'task_id': active['identity'].task_id, 'execution_generation': active['execution_generation'],
                    'status': active['status'], 'runtime_id': self._runtime_id(frozen)}
        return {'conversation': self._public_record(record), 'migration': self._public_record(record)['migration'], 'participants': [asdict(b) for b in self.store.participants(conversation_id)],
                'active_turn': turn, 'pending_delegations': self.notifications.delegations(conversation_id)}

    def events(self, conversation_id, after_seq=0, limit=100):
        self._authorize(conversation_id)
        page = self.store.events(conversation_id, after_seq, limit)
        from gateway.hosted_room_conversation_history import event_provenance
        with hosted_rooms._transaction(self.db_path) as conn:
            events = [{**event, 'provenance': event_provenance(conn, conversation_id, event['event_id'])}
                      for event in page.events]
        return {'events': events, 'cursor': page.cursor, 'has_more': page.has_more}

    def send(self, conversation_id, turn_id, input_id, participant_id, text,
             expected_revision, attachment_ids=None, command_token=None, surface=None, voice_context=None):
        from gateway.hosted_room_conversation_voice import voice_context_digest, freeze_voice_context
        voice_digest = voice_context_digest(surface, voice_context)
        request = TurnSubmission(turn_id, input_id, participant_id, text, tuple(attachment_ids or ()))
        with self._lock:
            owner = self._authorize(conversation_id, write=True)
            from gateway.hosted_room_conversation_migration import require_migration_complete
            with hosted_rooms._transaction(self.db_path) as conn:
                require_migration_complete(conn, conversation_id)
            from gateway.hosted_room_conversation_commands import ConversationCommandTokens, freeze_command
            resolution = ConversationCommandTokens(self.db_path).for_send(owner=owner,
                conversation_id=conversation_id, request=request, revision=expected_revision, token=command_token)
            if replay := self.store.replay(conversation_id, request, command_resolution=resolution, voice_digest=voice_digest):
                return {'admission': asdict(replay)}
            from gateway.hosted_room_conversation_compat import require_compatible_backends
            require_compatible_backends(self.db_path)
            record = self.store.check_admission(conversation_id, expected_revision)
            from .conversation_attachments import ConversationAttachments
            attachments = ConversationAttachments(self)
            attachments.selected(conversation_id, request.attachment_ids)
            participant = self._participant(participant_id)
            existing = next((b for b in self.store.participants(conversation_id)
                             if b.participant.participant_id == participant_id), None)
            # Display labels are historical; the catalog only authorizes immutable routing identity.
            if existing and (existing.participant.install_id, existing.participant.profile) != (participant.install_id, participant.profile):
                raise ConversationBindingError('participant routing identity changed')
            binding = existing or self.store.bind_participant(conversation_id, participant)
            revision = record.revision + (0 if existing else 1)
            runtime = resolve_conversation_session(self.server, binding=binding, project=record.project, source='desktop')
            binding = replace(binding, lineage_id=runtime.lineage_id)
            from tui_gateway.conversation_transport import repair_input_ack
            session = self.server._sessions[runtime.runtime_id]
            # A terminal failure can precede shared ACK even though the Profile input is durable.
            revision += sum(repair_input_ack(self.store, session, frozen)
                            for frozen in self.store.unacknowledged_inputs(binding))
            room = hosted_rooms.room_state(self.db_path, room_id=conversation_id, purpose='conversation')
            preparation = _Preparation(self.store, revision)
            with self.server._profile_build_scope(self.server._profile_home(runtime.profile)):
                envelope = prepare_turn_envelope(preparation, binding=binding, request=request,
                    input_cutoff=room['latest_seq'], budget_bytes=48 * 1024,
                    main_runtime=self.server._sessions[runtime.runtime_id]["agent"]._current_main_runtime())
            envelope = attachments.freeze(conversation_id, request, envelope)
            envelope = freeze_command(envelope, resolution)
            envelope = freeze_voice_context(envelope, voice_digest, voice_context)
            admission = self.store.admit_turn(binding, request, envelope,
                expected_revision=preparation.revision, input_cutoff=room['latest_seq'], command_resolution=resolution)
        if self.hosted:
            self.hosted.wakeup()
        return {'admission': asdict(admission)}

    def attach(self, conversation_id, filename, mime_type, data_base64):
        self._authorize(conversation_id, write=True)
        from .conversation_attachments import ConversationAttachments
        return ConversationAttachments(self).attach(conversation_id, filename, mime_type, data_base64)

    def content(self, conversation_id, content_id, offset_bytes=0, limit_bytes=65536):
        self._authorize(conversation_id)
        from .conversation_attachments import ConversationAttachments
        return ConversationAttachments(self).page(conversation_id, content_id, offset_bytes, limit_bytes)

    def bindings(self):
        return tuple(HostedRoomBinding(r['room_id'], r['authority_gateway_id'], r['authority_epoch'])
                     for r in hosted_rooms.list_rooms(self.db_path, purpose='conversation')
                     if r['authority_gateway_id'] == hosted_rooms.local_authority_gateway_id())

    def transport(self, binding, task):
        from .conversation_transport import ConversationTransport
        return ConversationTransport(self, task)

    def prepare_room(self, binding):
        # The user's admission already created the only task; no autonomous speaker selection.
        for task in self._tasks(binding.room_id):
            if task['status'] in ('settled', 'failed', 'cancelled'):
                self.publish_terminal(binding, task)
        from .conversation_notifications import drain_conversation_notifications
        drain_conversation_notifications(self, binding)

    def publish_terminal(self, binding, task):
        from gateway.hosted_room_conversation import publish_conversation_terminal
        publish_conversation_terminal(self.store, binding, task)

    def stop(self, conversation_id, turn_id, execution_generation, include_delegations=False):
        self._authorize(conversation_id, write=True)
        from .conversation_controls import stop_conversation
        return stop_conversation(self, conversation_id, turn_id, execution_generation, include_delegations)

    def runtime_snapshot(self, conversation_id, participant_id, session_generation):
        self._authorize(conversation_id)
        from .conversation_controls import runtime_snapshot
        return runtime_snapshot(self, conversation_id, participant_id, session_generation)

    def retry(self, conversation_id, turn_id, input_id, expected_generation):
        owner = self._authorize(conversation_id, write=True)
        task = driver.get_task(self.db_path, task_identity(conversation_id, turn_id, input_id))
        if (task.get('result') or {}).get('error') == 'restored_snapshot_requires_stop':
            raise ConversationBindingError('restored conversation work must be stopped before starting a new turn')
        if task['execution_generation'] != expected_generation:
            raise ConversationBindingError('execution generation changed')
        if task['status'] in ('indeterminate', 'deferred', 'running', 'stopping'):
            raise ConversationBindingError('reconciliation_required')
        frozen = self.store.input_for_task(task)
        if task['status'] == 'queued':
            binding = next((b for b in self.store.participants(conversation_id)
                            if b.participant.participant_id == frozen['participant_id']), None)
            if binding is None or binding.session_generation != frozen['session_generation']:
                raise ConversationBindingError('input belongs to a retired participant generation')
            resolve_conversation_session(self.server, binding=binding,
                project=self.store.get(conversation_id).project, source='desktop')
            if self.hosted:
                self.hosted.wakeup()
        request = TurnSubmission(turn_id, input_id, frozen['participant_id'], frozen['text'],
                                 tuple(json.loads(frozen['attachment_ids_json'])))
        from gateway.hosted_room_conversation_commands import ConversationCommandTokens
        resolution = ConversationCommandTokens(self.db_path).for_reconciliation(
            owner=owner, conversation_id=conversation_id, input_id=input_id)
        return {'admission': asdict(self.store.replay(conversation_id, request, command_resolution=resolution,
            voice_digest=json.loads(frozen['envelope_json']).get('voice_context_digest')))}

    def refresh(self, conversation_id, participant_id, expected_generation,
                model_source=None, model_id=None, reasoning_effort=None, fast=None):
        from tui_gateway.session_conversation_binding import refresh_conversation_preparation
        with self._lock:
            self._authorize(conversation_id, write=True)
            self._participant(participant_id)
            binding = next((b for b in self.store.participants(conversation_id)
                            if b.participant.participant_id == participant_id), None)
            if binding is None or binding.session_generation != expected_generation:
                raise ConversationBindingError('participant generation changed')
            prepared = refresh_conversation_preparation(self.server, binding=binding,
                project=self.store.get(conversation_id).project, source='desktop',
                model_source=model_source, model_id=model_id, reasoning_effort=reasoning_effort, fast=fast)
            return {'binding': asdict(replace(binding, session_generation=prepared['session_generation'],
                                              lineage_id=prepared['stored_session_id'])), 'preparation': prepared}
