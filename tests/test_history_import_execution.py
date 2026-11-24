"""Execution repair cannot turn someone else's import or edited history into a writable chat."""
import json

import pytest

from persistence import AuthorityRefusal
from persistence.authority.runtime import HistoryActor, Import, ImportControl
from persistence_assembly import open_persistence, profile_scope
from tests.fixtures.storage_holder import history_binding_key, raw_holder
from tests.fixtures.storage_seed import seed_session


def _restore(db, actor, repaired):
    sid = repaired['id']
    return db.runtime.mutate(
        db.runtime.begin_epoch(instance_id='history-recovery'), principal_id=actor.subject,
        session_id=sid, request_id='restore', expected_revision=db.sessions.get(sid).runtime_revision,
        command=Import((repaired,), restore_execution=True), history=ImportControl(actor, (sid,)), owner=None)


@pytest.mark.parametrize('case, reason', [
    ('foreign', 'permission_denied'), ('unbound', 'permission_denied'),
    ('changed', 'admission_conflict'), ('wrong-account', 'permission_denied'),
    ('stale-revision', 'revision_conflict'),
])
def test_recovery_refuses_to_rebind_foreign_or_changed_transcripts(tmp_path, case, reason):
    owner = {'platform_origin': 'https://api.aino.test', 'user_id': '10'}
    with open_persistence(profile_scope(home=tmp_path)) as db:
        assert db.maintenance.import_sessions([{'id': 'history', 'source': 'local', 'model_config': {'platform_owner': owner},
                                    'messages': [{'role': 'user', 'content': 'untouched question'}]}]).ok
        if case != 'unbound':
            db.state_meta.set(history_binding_key('history'), json.dumps([str(tmp_path), 'other' if case == 'foreign' else 'current']))
        if case == 'stale-revision':
            raw_holder(db)._execute_write(lambda conn: conn.execute('UPDATE sessions SET runtime_revision=1 WHERE id=?', ('history',)))
        original = db.maintenance.export_session('history', include_inactive=True)
        repaired = {**original.session.as_dict(),
                    'messages': [row.as_wire_row() for row in original.messages], 'source': 'gui', 'model': 'saved-model', '_recovery_revision': 0,
                    'model_config': {'platform_owner': owner, 'execution_mode': 'code'}}
        if case == 'changed':
            repaired['messages'] = [{**message, 'content': 'stale question'} for message in repaired['messages']]
        if case == 'wrong-account':
            repaired['model_config']['platform_owner'] = {**owner, 'user_id': '11'}
        actor = HistoryActor(profile_id=str(tmp_path), subject='current', login_label=None, may_create=True)
        with pytest.raises(AuthorityRefusal, match=reason):
            _restore(db, actor, repaired)
        assert db.maintenance.export_session('history', include_inactive=True) == original


def test_recovery_never_replaces_a_live_route(tmp_path):
    with open_persistence(profile_scope(home=tmp_path)) as db:
        seed_session(db, 'live', 'local', model='current-model', chat_id='live', session_key='owned-route')
        original = db.maintenance.export_session('live')
        repaired = {**original.session.as_dict(),
                    'messages': [row.as_wire_row() for row in original.messages], 'source': 'gui', 'model': 'old-model', 'model_config': {'execution_mode': 'code'}}
        actor = HistoryActor(profile_id=str(tmp_path), subject='current', login_label=None, may_create=True)
        _restore(db, actor, repaired)
        assert db.maintenance.export_session('live') == original
