"""Permanent source-lineage fences and frozen public migration manifests.

SQL guards also protect against cached SessionDB instances and older transcript writers.
The marker is never expired or removed by cleanup; failure requires the same receipt retry.
"""
from __future__ import annotations

import json
from dataclasses import dataclass


class SessionMigratedError(RuntimeError):
    def __init__(self, conversation_id):
        self.conversation_id = conversation_id
        super().__init__(f'Session belongs to conversation {conversation_id}; use its conversation route.')


@dataclass(frozen=True)
class MigrationReceipt:
    migration_id: str
    conversation_id: str
    source_profile: str
    source_lineage_id: str
    source_cutoff_row_id: int
    status: str
    source_session_ids: tuple[str, ...] = ()


def initialize_migration_schema(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS session_conversation_migrations (
        migration_id TEXT PRIMARY KEY, input_id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL, source_profile TEXT NOT NULL,
        source_lineage_id TEXT NOT NULL UNIQUE, owner_key TEXT NOT NULL,
        source_cutoff_row_id INTEGER NOT NULL, status TEXT NOT NULL,
        manifest_json TEXT NOT NULL, error TEXT)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS session_conversation_migration_members (
        session_id TEXT PRIMARY KEY, migration_id TEXT NOT NULL
        REFERENCES session_conversation_migrations(migration_id))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS session_migration_activities (
        activity_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, pid INTEGER NOT NULL,
        process_started REAL NOT NULL, body_finished INTEGER NOT NULL DEFAULT 0)''')
    conn.execute('CREATE INDEX IF NOT EXISTS session_migration_activities_source ON session_migration_activities(session_id)')
    if 'body_finished' not in {row[1] for row in conn.execute('PRAGMA table_info(session_migration_activities)')}:
        conn.execute('ALTER TABLE session_migration_activities ADD COLUMN body_finished INTEGER NOT NULL DEFAULT 0')
    protected_ids = """WITH RECURSIVE owned(session_id) AS (
        SELECT session_id FROM session_conversation_migration_members UNION
        SELECT a.activity_id FROM session_migration_activities a JOIN owned o ON a.session_id=o.session_id)
        SELECT session_id FROM owned"""
    # All metadata/destructive mutations are fenced, including raw SQL from warm clients.
    for table, column in (('messages', 'session_id'), ('sessions', 'id')):
        for action in ('INSERT', 'UPDATE', 'DELETE'):
            record = 'OLD' if action == 'DELETE' else 'NEW'
            checks = [f'{record}.{column} IN ({protected_ids})']
            if action == 'UPDATE':
                checks.append(f'OLD.{column} IN ({protected_ids})')
            if table == 'sessions' and action != 'DELETE':
                checks.append(f'NEW.parent_session_id IN ({protected_ids})')
            conn.execute(f'''CREATE TRIGGER IF NOT EXISTS migration_owned_fence_{table}_{action.lower()}
                BEFORE {action} ON {table} WHEN {' OR '.join(checks)}
                BEGIN SELECT RAISE(ABORT, 'session_conversation_migrated'); END''')
    for table, column in (('session_turn_leases', 'conversation_id'), ('compression_locks', 'session_id')):
        for action in ('INSERT', 'UPDATE'):
            conn.execute(f'''CREATE TRIGGER IF NOT EXISTS migration_owned_fence_{table}_{action.lower()}
                BEFORE {action} ON {table}
                WHEN NEW.{column} IN ({protected_ids})
                BEGIN SELECT RAISE(ABORT, 'session_conversation_migrated'); END''')
    for action in ('INSERT', 'UPDATE'):
        conn.execute(f'''CREATE TRIGGER IF NOT EXISTS migration_owned_fence_delegation_{action.lower()}
            BEFORE {action} ON async_delegations WHEN
            NEW.origin_session_id IN ({protected_ids}) OR
            NEW.parent_session_id IN ({protected_ids}) OR
            NEW.origin_session IN ({protected_ids})
            BEGIN SELECT RAISE(ABORT, 'session_conversation_migrated'); END''')


def receipt_from_row(row, members):
    return MigrationReceipt(**{key: row[key] for key in (
        'migration_id', 'conversation_id', 'source_profile', 'source_lineage_id',
        'source_cutoff_row_id', 'status')}, source_session_ids=tuple(members))


def _lineage_on_conn(db, conn, root, requested):
    current = conn.execute('SELECT * FROM sessions WHERE id=?', (root,)).fetchone()
    if current is None:
        raise ValueError('source lineage is unavailable')
    ids = []
    while current is not None:
        current = dict(current)
        if current['id'] in ids:
            raise ValueError('source lineage contains a cycle')
        ids.append(current['id'])
        if current['end_reason'] != 'compression':
            break
        children = [dict(r) for r in conn.execute('SELECT * FROM sessions WHERE parent_session_id=?',
                    (current['id'],)) if not db._is_explicit_fork_child_row(dict(r))]
        if len(children) != 1:
            raise ValueError('source compression lineage is incomplete or ambiguous')
        current = children[0]
    if requested not in ids:
        raise ValueError('source is not in its canonical compression lineage')
    return ids


def _require_no_live_background(ids):
    from tools.async_delegation import has_live_for_session
    from tools.process_registry import process_registry
    if any(has_live_for_session(session_key=sid, parent_session_id=sid) for sid in ids):
        raise ValueError('source has live background delegations')
    for item in process_registry.list_sessions(include_retained=True):
        process = process_registry.get(item['session_id'])
        if process and (process.parent_session_id in ids or process.session_key in ids or
                        process.task_id in ids or process.owner_task_id in ids) and (
                not process.exited or (process.notify_on_complete and
                    not process_registry.is_completion_consumed(process.id))):
            raise ValueError('source has unsettled background processes')

    # A preview can outlive its gateway. Inspect the existing durable checkpoint
    # without recovery's cleanup/adoption side effects or terminating any process.
    from tools.process_registry import _checkpoint_path
    checkpoint = _checkpoint_path()
    if checkpoint.is_file():
        try:
            entries = json.loads(checkpoint.read_text(encoding='utf-8'))
        except (OSError, ValueError) as exc:
            raise ValueError('background process checkpoint cannot be verified') from exc
        if not isinstance(entries, list):
            raise ValueError('background process checkpoint cannot be verified')
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError('background process checkpoint cannot be verified')
            if not any(entry.get(field) in ids for field in ('parent_session_id', 'session_key', 'task_id', 'owner_task_id')):
                continue
            if entry.get('pid_scope', 'host') != 'host' or process_registry._host_pid_is_ours(
                    entry.get('pid'), entry.get('host_start_time')):
                raise ValueError('source has unsettled background processes')


def _migration_row_on_conn(conn, session_id):
    return conn.execute('''WITH RECURSIVE owners(session_id) AS (
        SELECT ? UNION SELECT a.session_id FROM session_migration_activities a
        JOIN owners o ON a.activity_id=o.session_id)
        SELECT m.* FROM session_conversation_migrations m JOIN session_conversation_migration_members s
        USING(migration_id) JOIN owners o ON o.session_id=s.session_id''', (session_id,)).fetchone()


def _owned_activity_ids(conn, ids):
    import psutil
    marks = ','.join('?' for _ in ids)
    activities = conn.execute(f'''WITH RECURSIVE owned(session_id) AS (
        SELECT id FROM sessions WHERE id IN ({marks}) UNION
        SELECT a.activity_id FROM session_migration_activities a JOIN owned o ON a.session_id=o.session_id)
        SELECT a.* FROM session_migration_activities a JOIN owned o ON a.activity_id=o.session_id''', ids).fetchall()
    for activity in activities:
        if activity['body_finished']:
            continue
        try:
            live = psutil.Process(activity['pid']).create_time() == activity['process_started']
        except psutil.NoSuchProcess:
            live = False
        except psutil.AccessDenied as exc:
            raise ValueError('source side-task owner cannot be inspected') from exc
        if live:
            raise ValueError('source has an active background or side question')
        conn.execute('UPDATE session_migration_activities SET body_finished=1 WHERE activity_id=?', (activity['activity_id'],))
    return list(dict.fromkeys([*ids, *(row['activity_id'] for row in activities)]))


class SessionMigrationMixin:
    def _assert_session_not_migrated_on_conn(self, conn, session_id):
        row = _migration_row_on_conn(conn, self._session_turn_lease_key_on_conn(conn, session_id))
        if row:
            raise SessionMigratedError(row['conversation_id'])

    def assert_session_not_migrated(self, session_id):
        receipt = self.get_session_migration(session_id)
        if receipt:
            raise SessionMigratedError(receipt.conversation_id)

    def get_session_migration(self, session_id):
        if self._read_one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_conversation_migrations'") is None:
            return None
        with self._read_ctx() as conn:
            row = _migration_row_on_conn(conn, self._session_turn_lease_key_on_conn(conn, session_id))
        if row is None:
            return None
        members = self._read_all('SELECT session_id FROM session_conversation_migration_members WHERE migration_id=? ORDER BY session_id', (row['migration_id'],))
        return receipt_from_row(row, [r['session_id'] for r in members])

    def prepare_conversation_migration(self, *, source_profile, lineage_id, conversation_id,
                                       input_id, migration_id, owner_key, max_attachment_bytes=None):
        from gateway.hosted_room_conversation_owners import owner_key as durable_owner
        from tui_gateway.conversation_migration_projection import project_public_rows
        from tools.bot_mode_probe import BOT_CHAT_TITLE
        def write(conn):
            root = self._session_turn_lease_key_on_conn(conn, lineage_id)
            previous = conn.execute('SELECT * FROM session_conversation_migrations WHERE source_lineage_id=? OR input_id=?',
                                    (root, input_id)).fetchall()
            if previous:
                row = previous[0]
                if len(previous) != 1 or any(row[k] != v for k, v in {
                    'source_profile': source_profile, 'source_lineage_id': root,
                    'conversation_id': conversation_id, 'input_id': input_id, 'owner_key': owner_key,
                    'migration_id': migration_id}.items()):
                    raise ValueError('migration identity conflicts with an existing receipt')
                members = conn.execute('SELECT session_id FROM session_conversation_migration_members WHERE migration_id=? ORDER BY session_id', (migration_id,)).fetchall()
                return receipt_from_row(row, [r['session_id'] for r in members]), json.loads(row['manifest_json'])
            # The canonical chain distinguishes compression continuation from explicit forks.
            ids = _lineage_on_conn(self, conn, root, lineage_id)
            owned_ids = _owned_activity_ids(conn, ids)
            _require_no_live_background(owned_ids)
            if not ids or root not in ids:
                raise ValueError('source compression lineage is unavailable')
            marks = ','.join('?' for _ in ids)
            sessions = conn.execute(f'SELECT * FROM sessions WHERE id IN ({marks})', ids).fetchall()
            if len(sessions) != len(ids):
                raise ValueError('source lineage is incomplete')
            for row in sessions:
                if durable_owner(row['user_id']) != owner_key:
                    raise ValueError('source session belongs to another owner')
                config = json.loads(row['model_config'] or '{}')
                if row['source'] not in ('cli', 'tui', 'desktop', 'web', 'webui') or row['title'] == BOT_CHAT_TITLE or any(
                    config.get(key) for key in ('_conversation_binding', 'conversation_binding', 'bot_relay', 'hosted_room')):
                    raise ValueError('source session is not an ordinary legacy conversation')
            owned_marks = ','.join('?' for _ in owned_ids)
            # Expired leases are also busy: expiry is not evidence the model/tools stopped.
            if conn.execute(f'SELECT 1 FROM session_turn_leases WHERE conversation_id IN ({owned_marks}) LIMIT 1', owned_ids).fetchone() or conn.execute(
                    f'SELECT 1 FROM compression_locks WHERE session_id IN ({owned_marks}) LIMIT 1', owned_ids).fetchone():
                raise ValueError('source is busy; wait for its active work to settle')
            if conn.execute(f'''SELECT 1 FROM async_delegations WHERE
                    (origin_session_id IN ({owned_marks}) OR parent_session_id IN ({owned_marks}) OR origin_session IN ({owned_marks}))
                    AND (state IN ('running','stalling','finalizing') OR completed_at IS NULL OR delivery_state != 'delivered') LIMIT 1''', owned_ids * 3).fetchone():
                raise ValueError('source has unsettled background work')
            rows = conn.execute(f'SELECT session_id, {self._CONVERSATION_ROW_COLUMNS} FROM messages WHERE session_id IN ({marks}) AND (active=1 OR compacted=1) ORDER BY id', ids).fetchall()
            cutoff = conn.execute(f'SELECT COALESCE(MAX(id),0) FROM messages WHERE session_id IN ({marks})', ids).fetchone()[0]
            selected = self._dedupe_display_generations(rows)
            history = self._rows_to_conversation(selected, session_id=lineage_id, include_ancestors=True,
                repair_alternation=False, include_row_ids=True, include_summary_markers=True)
            manifest = project_public_rows(history, max_attachment_bytes=max_attachment_bytes)
            conn.execute('INSERT INTO session_conversation_migrations VALUES (?,?,?,?,?,?,?,?,?,NULL)',
                (migration_id, input_id, conversation_id, source_profile, root, owner_key, cutoff,
                 'preparing', json.dumps(manifest, ensure_ascii=False)))
            conn.executemany('INSERT INTO session_conversation_migration_members VALUES (?,?)',
                             [(sid, migration_id) for sid in ids])
            return MigrationReceipt(migration_id, conversation_id, source_profile, root, cutoff,
                                    'preparing', tuple(ids)), manifest
        return self._execute_write(write)

    def begin_migration_activity(self, session_id, activity_id):
        import os
        import psutil
        def write(conn):
            self._assert_session_not_migrated_on_conn(conn, session_id)
            conn.execute('INSERT INTO session_migration_activities(activity_id,session_id,pid,process_started) VALUES (?,?,?,?)',
                         (activity_id, session_id, os.getpid(), psutil.Process().create_time()))
        self._execute_write(write)

    def end_migration_activity(self, activity_id):
        self._execute_write(lambda conn: conn.execute(
            'UPDATE session_migration_activities SET body_finished=1 WHERE activity_id=?', (activity_id,)))

    def set_conversation_migration_status(self, migration_id, status, error=None):
        if status not in ('preparing', 'importing', 'complete', 'failed'):
            raise ValueError('invalid migration status')
        self._execute_write(lambda conn: conn.execute(
            'UPDATE session_conversation_migrations SET status=?,error=? WHERE migration_id=?',
            (status, error, migration_id)))
