"""Atomic public input, frozen context and existing driver admission."""
from __future__ import annotations

import json
import time
from dataclasses import asdict

from gateway import hosted_rooms, hosted_room_driver as driver

UNRESOLVED = ('queued', 'running', 'stopping', 'indeterminate', 'deferred')


class ConversationBusyError(hosted_rooms.RoomConflictError):
    pass


class ConversationAdmissionMixin:
    def participants(self, conversation_id):
        from .hosted_room_conversation_store import _binding_from_row
        with hosted_rooms._transaction(self.db_path) as conn:
            self._get_locked(conn, conversation_id)
            return tuple(_binding_from_row(row) for row in conn.execute(
                'SELECT * FROM hosted_room_conversation_participants WHERE conversation_id=? ORDER BY participant_id',
                (conversation_id,)))

    def list_conversations(self, *, cursor=None, limit=100, project=None, include_archived=False, owner_key=None, shared_project=False):
        with hosted_rooms._transaction(self.db_path) as conn:
            project_json = (hosted_rooms._canonical_json(asdict(project), label='project', max_bytes=65536)
                            if project is not None else None)
            ids = conn.execute('''SELECT conversation_id FROM hosted_room_conversations
                WHERE (? OR archived_at IS NULL) AND (? IS NULL OR conversation_id>?)
                AND (? IS NULL OR (NOT ? AND project_json=?) OR (? AND
                    json_extract(project_json, '$.install_id')=? AND
                    json_extract(project_json, '$.execution_environment_id')=? AND
                    json_extract(project_json, '$.cwd')=?))
                AND (? IS NULL OR conversation_id IN (SELECT conversation_id FROM hosted_conversation_owners WHERE owner_key=?))
                ORDER BY conversation_id LIMIT ?''',
                (include_archived, cursor, cursor, project_json, shared_project, project_json, shared_project,
                 project.install_id if project else None, project.execution_environment_id if project else None,
                 project.cwd if project else None, owner_key, owner_key, limit + 1)).fetchall()
            records = tuple(self._get_locked(conn, row[0]) for row in ids[:limit])
            return records, records[-1].conversation_id if len(ids) > limit else None, len(ids) > limit

    def _replay_locked(self, conn, conversation_id, submission, command_resolution=None):
        from .hosted_room_conversation_store import _admission_from_row
        row = conn.execute('''SELECT * FROM hosted_room_conversation_inputs
            WHERE conversation_id=? AND (input_id=? OR turn_id=?)''',
            (conversation_id, submission.input_id, submission.turn_id)).fetchone()
        if row is None:
            return None
        if (row['input_id'], row['turn_id'], row['participant_id'], row['text'],
                tuple(json.loads(row['attachment_ids_json']))) != (
                submission.input_id, submission.turn_id, submission.participant_id,
                submission.text, submission.attachment_ids):
            raise hosted_rooms.RoomConflictError('input_id or turn_id already has different content or recipient')
        from .hosted_room_conversation_commands import validate_command_replay_locked
        validate_command_replay_locked(conn, conversation_id, submission.input_id, command_resolution)
        return _admission_from_row(row, idempotent=True)

    def replay(self, conversation_id, submission, *, command_resolution=None):
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            self._get_locked(conn, conversation_id)
            return self._replay_locked(conn, conversation_id, submission, command_resolution)

    def _check_admission_locked(self, conn, conversation_id, expected_revision, *, continuation_notification_id=None):
        record = self._get_locked(conn, conversation_id)
        if record.archived or record.revision != expected_revision:
            raise hosted_rooms.RoomConflictError('conversation revision changed; preserve and retry the draft')
        if conn.execute('''SELECT 1 FROM hosted_room_driver_tasks WHERE room_id=?
                AND status IN ('queued','running','stopping','indeterminate','deferred') LIMIT 1''',
                (conversation_id,)).fetchone():
            raise ConversationBusyError('conversation is busy; preserve the draft')
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hosted_conversation_notifications'").fetchone():
            queued = conn.execute("""SELECT notification_id FROM hosted_conversation_notifications
                WHERE conversation_id=? AND state='queued' ORDER BY seq LIMIT 1""", (conversation_id,)).fetchone()
            if queued and queued[0] != continuation_notification_id:
                raise ConversationBusyError('background continuation is queued; preserve the draft')
        return record

    def check_admission(self, conversation_id, expected_revision):
        with hosted_rooms._transaction(self.db_path) as conn:
            return self._check_admission_locked(conn, conversation_id, expected_revision)

    def admit_turn(self, binding, submission, envelope, *, expected_revision, input_cutoff, command_resolution=None):
        from .hosted_room_conversation import plan_conversation_turn
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            if replay := self._replay_locked(conn, binding.conversation_id, submission, command_resolution):
                return replay
            record = self._check_admission_locked(conn, binding.conversation_id, expected_revision)
            current = conn.execute('''SELECT session_generation, lineage_id FROM
                hosted_room_conversation_participants WHERE conversation_id=? AND participant_id=?''',
                (binding.conversation_id, binding.participant.participant_id)).fetchone()
            cutoff = conn.execute('SELECT next_seq-1 FROM hosted_rooms WHERE room_id=?',
                                  (binding.conversation_id,)).fetchone()[0]
            if current is None or tuple(current) != (binding.session_generation, binding.lineage_id) or cutoff != input_cutoff:
                raise hosted_rooms.RoomConflictError('conversation context or participant generation changed')
            from .hosted_room_conversation_commands import consume_command_locked
            consume_command_locked(conn, command_resolution, binding, submission)
            admission = self._append_input_locked(conn, binding.conversation_id, submission, command_resolution=command_resolution)
            self._prepare_input_locked(conn, binding, submission.input_id, envelope)
            plan = plan_conversation_turn(record, binding, submission, admission, envelope)
            driver._admit_task_locked(conn, plan.identity, payload=plan.payload, clock=time.time)
            return admission

    def input_for_task(self, task):
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute('''SELECT i.*, p.session_generation, p.lineage_id, p.envelope_json
                FROM hosted_room_conversation_inputs i JOIN hosted_conversation_prepared_inputs p
                USING(conversation_id,input_id) WHERE i.conversation_id=? AND i.turn_id=?''',
                (task['identity'].room_id, task['identity'].turn_id)).fetchone()
            if row is None:
                raise hosted_rooms.RoomNotFoundError('task has no frozen conversation input')
            return dict(row)

    def unacknowledged_inputs(self, binding):
        with hosted_rooms._transaction(self.db_path) as conn:
            rows = conn.execute("""SELECT i.*, p.session_generation, p.lineage_id, p.envelope_json
                FROM hosted_room_conversation_inputs i JOIN hosted_conversation_prepared_inputs p
                USING(conversation_id,input_id)
                LEFT JOIN hosted_conversation_input_acks a USING(conversation_id,input_id)
                WHERE p.conversation_id=? AND p.participant_id=? AND p.session_generation=?
                    AND a.input_id IS NULL ORDER BY i.seq""",
                (binding.conversation_id, binding.participant.participant_id, binding.session_generation))
            return tuple(dict(row) for row in rows)
