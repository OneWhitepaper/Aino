"""A synchronized desktop transcript must retain its executable Work/Code choices."""
import json
from types import SimpleNamespace
from pathlib import Path

import pytest

from hermes_cli.desktop_history_recovery import run
from persistence_assembly import open_persistence, open_persistence_reader, profile_scope, store_location
from persistence.conversation.messages import NewMessage
from persistence.sqlite.conversation._store.local import POLICY_PREFIX
from tests.fixtures.storage_holder import raw_holder
from tests.hermes_cli.test_desktop_history_recovery import _export_session
from tests.gateway.fixtures.storage_handles import close_storage_handles
from tests.gateway.test_session_create_tier_cwd import _owner
from tests.hermes_cli.test_desktop_history_recovery import OWNER, _flatten, _request


@pytest.mark.asyncio
@pytest.mark.parametrize('previously_imported', [False, True])
@pytest.mark.parametrize('mode', ['work', 'code'])
@pytest.mark.parametrize('stored_source', ['gui', 'local'])
async def test_sync_rebinds_canonical_history_without_copying_old_authority(tmp_path, monkeypatch, mode, stored_source, previously_imported):
    from agent.runtime_scope import bind_profile_scope

    monkeypatch.chdir(tmp_path)
    request = _request(tmp_path)
    source, target = Path(request['source_home']), Path(request['target_home'])
    project = tmp_path / 'project'
    project.mkdir()
    config = {'model': {'provider': 'custom', 'default': 'saved-model',
                        'base_url': 'http://127.0.0.1:9/v1', 'api_mode': 'chat_completions'},
              'platform_toolsets': {'cli': []}}
    with bind_profile_scope(source, hydrate_secrets=False):
        store, _, authority, connection = _owner(source, monkeypatch, config)
        try:
            created = await connection.dispatch({'id': 'create', 'method': 'session.create', 'params': {
                'source': 'gui', 'request_id': 'original', 'execution_mode': mode,
                'model': 'saved-model', 'cwd': str(project), 'cwd_explicit': True, 'toolsets': []}})
            assert 'error' not in created, created
            sid = created['result']['session_id']
            db = authority.persistence
            db.messages.append(sid, NewMessage(role='user', content='Keep the previous context'))
            db.messages.append(sid, NewMessage(role='assistant', content='Previous answer'))
            db.sessions.patch_model_config(sid, {'platform_owner': OWNER})
            raw_holder(db)._execute_write(lambda conn: conn.execute('UPDATE sessions SET source=? WHERE id=?', (stored_source, sid)))
            original = _export_session(db, sid)
        finally:
            await connection.close()
            store.close_all_db_handles()

    inspected = run(request)
    prepared = run({**request, 'action': 'prepare', 'plan_id': inspected['planId']})
    rows = _flatten(prepared)
    assert len(rows) == 1, json.dumps([inspected, prepared, str(store_location(profile_scope(home=source))), original], indent=2)
    assert 'credential_ref' not in json.dumps(rows)
    assert all(rows[0].get(key) is None for key in ('user_id', 'session_key', 'chat_id', 'origin_json'))
    assert 'config_secret_ref' not in json.dumps(rows)
    # A different current default must not silently replace the saved route or model.
    with bind_profile_scope(target, hydrate_secrets=False):
        store, _, authority, connection = _owner(target, monkeypatch, {
            **config, 'model': {'provider': 'openai', 'default': 'different-current-default'}})
        try:
            if previously_imported:
                legacy_import = await connection.dispatch({'id': 'old-import', 'method': 'session.mutate', 'params': {
                    'session_id': sid, 'request_id': 'old-sync', 'expected_revision': 0,
                    'operation': 'import', 'payload': {'sessions': [original]}}})
                assert 'error' not in legacy_import, legacy_import
                inspected = run(request)
                prepared = run({**request, 'action': 'prepare', 'plan_id': inspected['planId']})
                rows = _flatten(prepared)
                assert len(rows) == 1, 'An earlier transcript-only import must remain repairable'
            imported = await connection.dispatch({'id': 'import', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'sync', 'expected_revision': 1 if previously_imported else 0,
                'operation': 'import', 'payload': {'sessions': rows, 'restore_execution': True}}})
            assert 'error' not in imported, imported
            assert authority.persistence.state_meta.get(POLICY_PREFIX + sid) is None
            # Grant the same native owner capability as the authenticated desktop connection.
            authority._native_legacy_transports = {connection.actor.transport_id: connection.actor}
            listed = await connection.dispatch({'id': 'list', 'method': 'session.list', 'params': {'scope': 'stored'}})
            visible = next(row for row in listed['result']['sessions'] if row['session_id'] == sid)
            assert visible['execution_mode'] == mode, listed
            resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume', 'params': {'session_id': sid}})
            assert 'error' not in resumed, resumed
            info = resumed['result']['info']
            assert (info['execution_mode'], info['model'], info['cwd']) == (mode, 'saved-model', str(project))
            assert 'Previous answer' in json.dumps(resumed['result']['messages'])
            receipt = json.loads(authority.persistence.state_meta.get(POLICY_PREFIX + sid))
            assert receipt['principal_id'] == connection.actor.subject
            assert receipt['policy']['execution_mode'] == mode
            route = json.loads(receipt['policy']['config_json'])['model']
            assert route['base_url'] == 'http://127.0.0.1:9/v1'
            assert route['api_mode'] == 'chat_completions'
        finally:
            await connection.close()
            store.close_all_db_handles()
    with open_persistence_reader(source) as db:
        assert _export_session(db, sid) == original


def test_bot_chat_profile_following_keeps_its_code_workspace_and_mode():
    from gateway.session_local_migration import legacy_bot_chat_launch

    params, wire = legacy_bot_chat_launch(
        SimpleNamespace(title='Bot Chat', model_config={}),
        {'source': 'gui', 'execution_mode': 'code', 'cwd': '/saved/project', 'cwd_explicit': True,
         'row_cwd': '', 'model': 'old-profile-model'},
        'chat_completions', {'model': {'default': 'current-profile-model'}})
    assert params['execution_mode'] == 'code'
    assert params['cwd'] == '/saved/project' and params['cwd_explicit'] is True and params['row_cwd'] == ''
    assert 'model' not in params and wire is None


def test_runtime_action_cannot_copy_an_unapproved_accounts_files(tmp_path):
    from tests.hermes_cli.test_desktop_history_recovery import OTHER, _owned, _seed

    request = _request(tmp_path)
    source = Path(request['source_home'])
    _seed(source, [_owned('mine'), _owned('foreign', OTHER)]).close()
    inspected = run(request)
    runtime = {**request, 'action': 'runtime', 'plan_id': inspected['planId'], 'profile': 'default'}
    with pytest.raises(ValueError, match='no longer approved'):
        run({**runtime, 'session_ids': ['foreign']})
    assert not (Path(request['target_home']) / 'code').exists()
    restored = run({**runtime, 'session_ids': ['mine']})
    assert [row['id'] for row in restored['sessions']] == ['mine']
    assert not restored['runtime']['threads']
