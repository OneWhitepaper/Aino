"""Durable runtime generations in the conversation authority's shared database."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_store

import json
import time
from dataclasses import asdict, replace
from pathlib import Path

from gateway import hosted_rooms
from gateway.hosted_room_conversation_types import ParticipantBinding, ProjectRef


class ConversationBindingError(RuntimeError):
    """A runtime cannot safely continue this generation."""


def saved_model_selection(record):
    selection = json.loads(record.get('selection_json') or '{}') if record else {}
    if record and not selection:
        snapshot = json.loads(record['model_snapshot'])
        if snapshot.get('model_source') == 'aino':
            selection = {'model_source': 'aino', 'model_id': snapshot['model_id']}
    return selection


def public_options(snapshot):
    reasoning = snapshot.get('reasoning_config')
    effort = None
    if isinstance(reasoning, dict):
        effort = 'none' if reasoning.get('enabled') is False else reasoning.get('effort')
    caps = snapshot.get('option_capabilities')
    public_caps = {key: caps.get(key) for key in ('reasoning', 'fast', 'can_disable_reasoning')} if isinstance(caps, dict) else None
    return {'reasoning_effort': effort, 'fast': snapshot.get('service_tier') == 'priority', 'capabilities': public_caps}


@managed_store
class ConversationBindings:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS hosted_room_conversation_runtimes (
                conversation_id TEXT NOT NULL, participant_id TEXT NOT NULL,
                session_generation INTEGER NOT NULL, lineage_id TEXT NOT NULL,
                profile TEXT NOT NULL, profile_home TEXT NOT NULL, cwd TEXT NOT NULL,
                source TEXT NOT NULL, auth_user_id TEXT, model_snapshot TEXT NOT NULL,
                capability_digest TEXT NOT NULL, system_prompt_digest TEXT,
                selection_json TEXT NOT NULL DEFAULT '{}',
                PRIMARY KEY(conversation_id, participant_id, session_generation),
                UNIQUE(profile_home, lineage_id))""")
            if 'selection_json' not in {row[1] for row in conn.execute(
                    'PRAGMA table_info(hosted_room_conversation_runtimes)')}:
                conn.execute("ALTER TABLE hosted_room_conversation_runtimes "
                             "ADD COLUMN selection_json TEXT NOT NULL DEFAULT '{}'")

    def public_model_snapshot(self, conversation_id: str, participant_id: str, generation: int, *, include_prepared=False) -> dict | None:
        """Public events require completion; the runtime picker may display a validated draft."""
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute("""SELECT model_snapshot,capability_digest
                FROM hosted_room_conversation_runtimes
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""",
                (conversation_id, participant_id, generation)).fetchone()
        if row is None or (not row['capability_digest'] and not include_prepared):
            return None
        snapshot = json.loads(row['model_snapshot'])
        if not snapshot.get('model'):
            return None
        # Runtime storage includes routing and owner data; none belongs in the public log.
        return {**{key: snapshot.get(key) for key in ('model', 'provider', 'model_source', 'model_id')},
                **public_options(snapshot)}

    def _current(self, conn, binding: ParticipantBinding, project: ProjectRef | None = None,
                 *, check_project: bool = False):
        row = conn.execute("""SELECT p.*, c.project_json, c.archived_at, r.disbanded_at
            FROM hosted_room_conversation_participants p
            JOIN hosted_room_conversations c USING(conversation_id)
            JOIN hosted_rooms r ON r.room_id=p.conversation_id
            WHERE p.conversation_id=? AND p.participant_id=?""",
            (binding.conversation_id, binding.participant.participant_id)).fetchone()
        if row is None or row['archived_at'] is not None or row['disbanded_at'] is not None:
            raise ConversationBindingError('conversation participant is unavailable')
        if (row['session_generation'], row['profile'], row['install_id']) != (
                binding.session_generation, binding.participant.profile, binding.participant.install_id):
            raise ConversationBindingError('conversation generation or participant identity changed')
        if binding.lineage_id is not None and row['lineage_id'] != binding.lineage_id:
            raise ConversationBindingError('conversation lineage changed')
        if check_project and (json.loads(row['project_json']) if row['project_json'] else None) != (
                asdict(project) if project is not None else None):
            raise ConversationBindingError('conversation project changed')
        return row

    def resolve(self, binding: ParticipantBinding, project: ProjectRef | None) -> dict | None:
        with hosted_rooms._transaction(self.db_path) as conn:
            self._current(conn, binding, project, check_project=True)
            row = conn.execute("""SELECT * FROM hosted_room_conversation_runtimes
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""",
                (binding.conversation_id, binding.participant.participant_id, binding.session_generation)).fetchone()
            return dict(row) if row else None

    def previous_runtime(self, binding: ParticipantBinding) -> dict | None:
        with hosted_rooms._transaction(self.db_path) as conn:
            self._current(conn, binding)
            row = conn.execute('''SELECT * FROM hosted_room_conversation_runtimes
                WHERE conversation_id=? AND participant_id=? AND session_generation<?
                ORDER BY session_generation DESC LIMIT 1''',
                (binding.conversation_id, binding.participant.participant_id, binding.session_generation)).fetchone()
            return dict(row) if row else None

    def publish(self, binding: ParticipantBinding, project: ProjectRef | None, record: dict) -> dict:
        """Reserve the exact generation only after its Profile session row is durable."""
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            current = self._current(conn, binding, project, check_project=True)
            keys = ('conversation_id', 'participant_id', 'session_generation', 'lineage_id',
                    'profile', 'profile_home', 'cwd', 'source', 'auth_user_id', 'model_snapshot',
                    'capability_digest', 'system_prompt_digest', 'selection_json')
            conn.execute(f"INSERT OR IGNORE INTO hosted_room_conversation_runtimes ({','.join(keys)}) "
                         f"VALUES ({','.join('?' for _ in keys)})", tuple(record.get(k) for k in keys))
            row = conn.execute("""SELECT * FROM hosted_room_conversation_runtimes
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""",
                (binding.conversation_id, binding.participant.participant_id, binding.session_generation)).fetchone()
            if row['lineage_id'] != record['lineage_id']:
                raise ConversationBindingError('another runtime already bound this generation; resolve again')
            if current['lineage_id'] not in (None, row['lineage_id']):
                raise ConversationBindingError('generation has a different lineage')
            conn.execute("""UPDATE hosted_room_conversation_participants SET lineage_id=?
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""",
                (row['lineage_id'], binding.conversation_id, binding.participant.participant_id,
                 binding.session_generation))
            return dict(row)

    def complete(self, binding: ParticipantBinding, project: ProjectRef | None, record: dict) -> dict:
        """Publish a built snapshot once, retaining the previously reserved identity."""
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            self._current(conn, binding, project, check_project=True)
            args = (binding.conversation_id, binding.participant.participant_id, binding.session_generation)
            row = conn.execute("""SELECT * FROM hosted_room_conversation_runtimes
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""", args).fetchone()
            if row is None or row['lineage_id'] != record['lineage_id']:
                raise ConversationBindingError('conversation draft reservation changed')
            if row['capability_digest']:
                if any(row[key] != record[key] for key in ('model_snapshot', 'capability_digest')):
                    raise ConversationBindingError('generation snapshot already initialized; explicitly refresh')
                return dict(row)
            conn.execute("""UPDATE hosted_room_conversation_runtimes
                SET model_snapshot=?, capability_digest=?
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""",
                (record['model_snapshot'], record['capability_digest'], *args))
            return {**dict(row), 'model_snapshot': record['model_snapshot'],
                    'capability_digest': record['capability_digest']}

    def for_session(self, profile_home: str, lineage_id: str, marker: dict | None = None) -> dict | None:
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute("""SELECT r.* FROM hosted_room_conversation_runtimes r
                JOIN hosted_room_conversation_participants p
                  USING(conversation_id, participant_id, session_generation)
                WHERE r.profile_home=? AND r.lineage_id=?""", (profile_home, lineage_id)).fetchone()
            if row is None and marker:
                row = conn.execute("""SELECT r.* FROM hosted_room_conversation_runtimes r
                    JOIN hosted_room_conversation_participants p
                      USING(conversation_id, participant_id, session_generation)
                    WHERE r.profile_home=? AND r.conversation_id=? AND r.participant_id=?
                      AND r.session_generation=?""", (profile_home, marker.get('conversation_id'),
                    marker.get('participant_id'), marker.get('session_generation'))).fetchone()
            return dict(row) if row else None

    def record_prompt(self, record: dict, digest: str) -> None:
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            args = (record['conversation_id'], record['participant_id'], record['session_generation'])
            row = conn.execute("""SELECT system_prompt_digest FROM hosted_room_conversation_runtimes
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""", args).fetchone()
            if row is None:
                raise ConversationBindingError('runtime binding is not durable')
            if row[0] is not None and row[0] != digest:
                raise ConversationBindingError('system prompt changed; explicitly start a new generation')
            conn.execute("""UPDATE hosted_room_conversation_runtimes SET system_prompt_digest=?
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""", (digest, *args))

    def advance(self, binding: ParticipantBinding, project: ProjectRef | None) -> ParticipantBinding:
        """Explicitly start a new generation; an unresolved task keeps ownership of the old one."""
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            current = self._current(conn, binding, project, check_project=True)
            has_tasks = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                                     "AND name='hosted_room_driver_tasks'").fetchone()
            if has_tasks:
                tasks = conn.execute("""SELECT payload_json FROM hosted_room_driver_tasks
                    WHERE room_id=? AND status IN ('running','stopping','indeterminate','queued','deferred')""",
                    (binding.conversation_id,)).fetchall()
                if any(json.loads(t[0]).get('target_member_id') == binding.participant.participant_id for t in tasks):
                    raise ConversationBindingError('resolve participant tasks before refreshing its generation')
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hosted_conversation_background_origins'").fetchone():
                args = (binding.conversation_id, binding.participant.participant_id, binding.session_generation)
                pending = conn.execute("""SELECT 1 FROM hosted_conversation_background_origins
                    WHERE conversation_id=? AND participant_id=? AND session_generation=? AND state='pending'
                    UNION ALL SELECT 1 FROM hosted_conversation_notifications WHERE conversation_id=?
                    AND participant_id=? AND session_generation=? AND state='queued' LIMIT 1""", args + args).fetchone()
                if pending:
                    raise ConversationBindingError('resolve participant background tasks before refreshing its generation')
            generation = int(current['session_generation']) + 1
            conn.execute("""UPDATE hosted_room_conversation_participants
                SET session_generation=?, lineage_id=NULL WHERE conversation_id=? AND participant_id=?""",
                (generation, binding.conversation_id, binding.participant.participant_id))
            conn.execute("UPDATE hosted_rooms SET revision=revision+1, updated_at=? WHERE room_id=?",
                         (time.time(), binding.conversation_id))
            return replace(binding, session_generation=generation, lineage_id=None)
