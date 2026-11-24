"""Recovery preserves launch choices even before a first turn binds credentials."""

from persistence.conversation.messages import NewMessage
from dataclasses import asdict
from tests.fixtures.storage_read import session_row
import json
from pathlib import Path
import pytest
from agent.runtime_scope import bind_profile_scope
from gateway.session_platform_model import selection_for_policy
from gateway.session_policy import policy_for_source
from hermes_cli.desktop_history_recovery import run

from tests.gateway.fixtures.storage_handles import close_storage_handles
from tests.gateway.test_session_create_tier_cwd import _owner

pytestmark = pytest.mark.usefixtures("authority_cwd_in_tmp")
from tests.hermes_cli.test_desktop_history_recovery import OWNER, _request, _flatten, _export_session

@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['work', 'code'])
async def test_created_aino_selection_survives_recovery(tmp_path, monkeypatch, mode):
    req = _request(tmp_path)
    source = Path(req['source_home'])
    with bind_profile_scope(source, hydrate_secrets=False):

        store, runner, authority, connection = _owner(source, monkeypatch, {
            'model': {'provider': 'custom', 'default': 'other', 'base_url': 'http://127.0.0.1:9/v1'},
            'platform_toolsets': {'cli': []}})
        try:
            response = await connection.dispatch({'id': 'create', 'method': 'session.create', 'params': {
                'request_id': 'selected', 'source': 'gui', 'cwd': str(tmp_path), 'cwd_explicit': True,
                'execution_mode': mode, 'toolsets': [],
                'model_source': 'aino', 'model_id': 'catalog-a'}})
            assert 'error' not in response, response
            sid = response['result']['session_id']
            original_policy = policy_for_source(runner, authority.sessions[sid].source)
            assert selection_for_policy(original_policy) == {'model_source': 'aino', 'model_id': 'catalog-a'}
            authority.persistence.sessions.patch_model_config(sid, {'platform_owner': OWNER})
            authority.persistence.messages.append(sid, NewMessage(role='user', content='pending conversation'))
        finally:
            await connection.close()
            store.close_all_db_handles()
    inspected = run(req)
    rows = _flatten(run({**req, 'action': 'prepare', 'plan_id': inspected['planId']}))
    assert len(rows) == 1
    target = Path(req['target_home'])
    with bind_profile_scope(target, hydrate_secrets=False):

        store, runner, authority, connection = _owner(target, monkeypatch, {'model': {'default': 'other'}})
        try:
            response = await connection.dispatch({'id': 'sync', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'sync', 'expected_revision': 0,
                'operation': 'import', 'payload': {'sessions': rows, 'restore_execution': True}}})
            assert 'error' not in response, response
            authority._native_legacy_transports = {connection.actor.transport_id: connection.actor}
            resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume', 'params': {'session_id': sid}})
            assert 'error' not in resumed, resumed
            assert resumed['result']['info'].get('model_source') == 'aino', resumed['result']['info']
            assert resumed['result']['info'].get('model_id') == 'catalog-a'
        finally:
            await connection.close()
            store.close_all_db_handles()

@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['work', 'code'])
@pytest.mark.parametrize('row_stamp', ['blank', 'other'])
async def test_work_cwd_provenance_survives_recovery(tmp_path, monkeypatch, mode, row_stamp):
    from gateway.session_local_migration import legacy_launch_params
    req = _request(tmp_path)
    source, target = (Path(req[key]) for key in ('source_home', 'target_home'))
    project = tmp_path / 'explicit-project'
    project.mkdir()
    with bind_profile_scope(source, hydrate_secrets=False):

        store, _runner, authority, connection = _owner(source, monkeypatch, {'model': {'default': 'm'}})
        try:
            created = await connection.dispatch({'id': 'create', 'method': 'session.create', 'params': {
                'request_id': 'work', 'source': 'cli', 'execution_mode': mode,
                'cwd': str(project), 'cwd_explicit': True, 'row_cwd': '' if row_stamp == 'blank' else str(tmp_path), 'toolsets': []}})
            assert 'error' not in created, created
            sid = created['result']['session_id']
            assert asdict(authority.persistence.bindings.receipt(sid))['policy']['cwd'] == str(project)
            authority.persistence.sessions.patch_model_config(sid, {'platform_owner': OWNER})
        finally:
            await connection.close()
            store.close_all_db_handles()
    inspected = run(req)
    rows = _flatten(run({**req, 'action': 'prepare', 'plan_id': inspected['planId']}))
    with bind_profile_scope(target, hydrate_secrets=False):

        store, _runner, authority, connection = _owner(target, monkeypatch, {'model': {'default': 'm'}})
        try:
            imported = await connection.dispatch({'id': 'sync', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'sync', 'expected_revision': 0,
                'operation': 'import', 'payload': {'sessions': rows, 'restore_execution': True}}})
            assert 'error' not in imported, imported
            params, _ = legacy_launch_params(authority.persistence.sessions.get(sid))
            assert params.get('cwd') == str(project), params
            authority._native_legacy_transports = {connection.actor.transport_id: connection.actor}
            resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume', 'params': {'session_id': sid}})
            assert 'error' not in resumed, resumed
            assert resumed['result']['info']['cwd'] == str(project)
            assert session_row(authority.persistence, sid)['cwd'] == (None if row_stamp == 'blank' else str(tmp_path))
        finally:
            await connection.close()
            store.close_all_db_handles()

@pytest.mark.asyncio
@pytest.mark.parametrize('source_label', ['tool', 'oneshot'])
async def test_prior_cli_family_code_import_is_repaired(tmp_path, monkeypatch, source_label):
    req = _request(tmp_path)
    source, target = (Path(req[key]) for key in ('source_home', 'target_home'))
    with bind_profile_scope(source, hydrate_secrets=False):

        store, _runner, authority, connection = _owner(source, monkeypatch, {'model': {'default': 'm'}})
        try:
            response = await connection.dispatch({'id': 'create', 'method': 'session.create', 'params': {
                'request_id': 'cli-code', 'source': source_label, 'execution_mode': 'code',
                'cwd': str(tmp_path), 'cwd_explicit': True, 'toolsets': []}})
            assert 'error' not in response, response
            sid = response['result']['session_id']
            authority.persistence.sessions.patch_model_config(sid, {'platform_owner': OWNER})
            authority.persistence.messages.append(sid, NewMessage(role='user', content='original code request'))
            original = _export_session(authority.persistence, sid, include_inactive=True)
        finally:
            await connection.close()
            store.close_all_db_handles()
    with bind_profile_scope(target, hydrate_secrets=False):

        store, _runner, authority, connection = _owner(target, monkeypatch, {'model': {'default': 'different'}})
        try:
            old = await connection.dispatch({'id': 'old', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'old-import', 'expected_revision': 0,
                'operation': 'import', 'payload': {'sessions': [original]}}})
            assert 'error' not in old, old
            inspected = run(req)
            rows = _flatten(run({**req, 'action': 'prepare', 'plan_id': inspected['planId']}))
            assert len(rows) == 1 and rows[0]['model_config']['execution_mode'] == 'code', rows
            repaired = await connection.dispatch({'id': 'repair', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'repair', 'expected_revision': rows[0]['_recovery_revision'],
                'operation': 'import', 'payload': {'sessions': rows, 'restore_execution': True}}})
            assert 'error' not in repaired, repaired
            assert authority.persistence.sessions.get_model_config_value(sid, 'execution_mode') == 'code', repaired
        finally:
            await connection.close()
            store.close_all_db_handles()
