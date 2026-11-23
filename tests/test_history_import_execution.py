"""Execution repair cannot turn someone else's import or edited history into a writable chat."""
import json
from types import SimpleNamespace

import pytest

from hermes_state import SessionDB
from hermes_state_mutation_binding import BINDING_PREFIX, restore_import_execution
from hermes_state_runtime import RuntimeStoreError


@pytest.mark.parametrize('case, reason', [
    ('foreign', 'permission_denied'), ('unbound', 'permission_denied'),
    ('changed', 'admission_conflict'), ('wrong-account', 'permission_denied'),
    ('stale-revision', 'revision_conflict'),
])
def test_recovery_refuses_to_rebind_foreign_or_changed_transcripts(tmp_path, case, reason):
    owner = {'platform_origin': 'https://api.aino.test', 'user_id': '10'}
    with SessionDB(db_path=tmp_path / 'state.db') as db:
        assert db.import_sessions([{'id': 'history', 'source': 'local', 'model_config': {'platform_owner': owner},
                                    'messages': [{'role': 'user', 'content': 'untouched question'}]}])['ok']
        if case != 'unbound':
            db.set_meta(BINDING_PREFIX + 'history', json.dumps([str(tmp_path), 'other' if case == 'foreign' else 'current']))
        if case == 'stale-revision':
            db._execute_write(lambda conn: conn.execute('UPDATE sessions SET runtime_revision=1 WHERE id=?', ('history',)))
        original = db.export_session('history', include_inactive=True)
        repaired = {**original, 'source': 'gui', 'model': 'saved-model', '_recovery_revision': 0,
                    'model_config': {'platform_owner': owner, 'execution_mode': 'code'}}
        if case == 'changed':
            repaired['messages'] = [{**message, 'content': 'stale question'} for message in original['messages']]
        if case == 'wrong-account':
            repaired['model_config']['platform_owner'] = {**owner, 'user_id': '11'}
        actor = SimpleNamespace(subject='current', profile_id=str(tmp_path))
        with pytest.raises(RuntimeStoreError, match=reason):
            db._execute_write(lambda conn: restore_import_execution(db, conn, actor, [repaired]))
        assert db.export_session('history', include_inactive=True) == original


def test_recovery_never_replaces_a_live_route(tmp_path):
    with SessionDB(db_path=tmp_path / 'state.db') as db:
        db.create_session('live', source='local', model='current-model')
        db._execute_write(lambda conn: conn.execute('UPDATE sessions SET chat_id=?,session_key=? WHERE id=?',
                                                   ('live', 'owned-route', 'live')))
        original = db.export_session('live')
        repaired = {**original, 'source': 'gui', 'model': 'old-model', 'model_config': {'execution_mode': 'code'}}
        db._execute_write(lambda conn: restore_import_execution(db, conn, SimpleNamespace(subject='current'), [repaired]))
        assert db.export_session('live') == original
