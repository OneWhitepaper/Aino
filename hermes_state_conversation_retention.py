"""Legacy cleanup may remove ordinary rows, never a conversation's durable evidence."""
import json
import sqlite3
from contextlib import closing
from pathlib import Path


def protected_session_ids(conn, *, allow_empty_draft=None, db_path=None):
    rows = conn.execute('SELECT id,parent_session_id,model_config FROM sessions').fetchall()
    graph, protected = {}, set()
    for row in rows:
        sid = row['id']
        try:
            config = json.loads(row['model_config'] or '{}')
        except (ValueError, TypeError):
            config = {}
        config = config if isinstance(config, dict) else {}
        if isinstance(config.get('conversation_binding'), dict):
            protected.add(sid)
        graph.setdefault(sid, set())
        for parent in (row['parent_session_id'], config.get('_delegate_from')):
            if isinstance(parent, str) and parent:
                graph[sid].add(parent)
                graph.setdefault(parent, set()).add(sid)
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='session_migration_activities' AND type='table'").fetchone():
        for activity, owner in conn.execute('SELECT activity_id,session_id FROM session_migration_activities'):
            graph.setdefault(activity, set()).add(owner)
            graph.setdefault(owner, set()).add(activity)
    durable = set()
    for table in ('conversation_input_receipts', 'session_conversation_migration_members'):
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'", (table,)).fetchone():
            durable.update(row[0] for row in conn.execute(f'SELECT session_id FROM {table}'))
    if allow_empty_draft in protected and allow_empty_draft not in durable and not graph[allow_empty_draft]:
        # This sole cleanup exception runs under a maintenance permit. Generic
        # sweeps do not delete drafts before their preparation can publish.
        empty = not conn.execute('SELECT 1 FROM messages WHERE session_id=? LIMIT 1', (allow_empty_draft,)).fetchone()
        home = Path(db_path).resolve().parent
        root = home.parent.parent if home.parent.name == 'profiles' else home
        shared = root / 'shared-state.db'
        bound = False
        if shared.exists():
            with closing(sqlite3.connect(f'{shared.as_uri()}?mode=ro', uri=True, timeout=.1)) as state:
                if state.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_room_conversation_runtimes'").fetchone():
                    bound = state.execute('SELECT 1 FROM hosted_room_conversation_runtimes '
                        'WHERE profile_home=? AND lineage_id=? LIMIT 1', (str(home), allow_empty_draft)).fetchone() is not None
        if empty and not bound:
            protected.remove(allow_empty_draft)
    protected.update(durable)
    pending = list(protected)
    while pending:
        for related in graph.get(pending.pop(), ()):
            if related not in protected:
                protected.add(related)
                pending.append(related)
    return protected
