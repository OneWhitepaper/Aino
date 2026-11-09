"""Hosted model preparation respects the room member's saved conversation intent."""
import json

import pytest

from tests.gateway.test_session_group_models import OWNER, _connection, _gateway, _members, _prepare, _request


@pytest.mark.parametrize('member', ['default', 'helper'])
def test_inspection_does_not_create_a_member_session_and_preserves_saved_selection(tmp_path, monkeypatch, member):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer = _connection(runner.session_authority)
        result = _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
        assert 'result' in result, result
        target = runner.session_authorities.for_home(homes[member])
        before = set(target.sessions)
        inspected = _request(call, viewer, 'groups.prepare_model', room_id='room', member_id=member, inspect_selection=True)
        assert 'result' in inspected, inspected
        sid = inspected['result']['session_id']
        assert inspected['result'] == {'profile': member, 'session_id': sid, 'selection': None}
        assert set(target.sessions) == before
        assert target.db.get_session(sid) is None
        prepared = _prepare(call, viewer, member)
        assert 'result' in prepared, prepared
        selected = {'model_id': 'selected-deepseek', 'model_source': 'aino', 'provider': 'aino', 'name': 'DeepSeek', 'owner': OWNER}
        monkeypatch.setattr('gateway.session_model_requests.selection_for_session', lambda authority, session_id: selected)
        inspected = _request(call, viewer, 'groups.prepare_model', room_id='room', member_id=member, inspect_selection=True)
        assert inspected['result']['selection'] == selected
        again = _prepare(call, viewer, member)
        assert 'result' in again, again
        assert again['result']['model_id'] == 'selected-deepseek'
        assert target.sessions[sid].model_catalog_viewer[1] is viewer.transport
        call(viewer.close())


def test_saved_aino_choice_cannot_be_rebound_to_a_different_account(tmp_path, monkeypatch):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, _homes, call):
        viewer = _connection(runner.session_authority)
        result = _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
        assert 'result' in result, result
        prepared = _prepare(call, viewer)
        assert 'result' in prepared, prepared
        selected = {'model_id': 'selected-deepseek', 'model_source': 'aino', 'provider': 'aino', 'owner': {**OWNER, 'user_id': 'other-account'}}
        monkeypatch.setattr('gateway.session_model_requests.selection_for_session', lambda authority, session_id: selected)
        denied = _prepare(call, viewer)
        assert denied['error']['data']['reason'] == 'managed_binding_forbidden', denied
        call(viewer.close())


def test_saved_configured_provider_choice_uses_existing_model_mutation_without_changing_profile(tmp_path, monkeypatch):
    from gateway.session_policy import policy_for_source
    from hermes_state_local import local_receipt

    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer = _connection(runner.session_authority)
        result = _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
        assert 'result' in result, result
        prepared = _prepare(call, viewer)
        assert 'result' in prepared, prepared
        target, sid = runner.session_authorities.for_home(homes['helper']), prepared['result']['session_id']
        original = local_receipt(target.db, sid)
        config = json.dumps({'model': {'provider': 'custom:relay', 'default': 'profile-default'},
                             'providers': {'relay': {'name': 'Relay', 'base_url': 'http://127.0.0.1:9/v1',
                                                      'api_key': 'fixture-private-key', 'models': ['chosen-model']}},
                             'platform_toolsets': {'cli': []}})
        (homes['helper'] / 'config.yaml').write_text(config)
        selected = {'model_id': 'chosen-model', 'model_source': 'provider', 'provider': 'custom:relay'}
        monkeypatch.setattr('gateway.session_model_requests.selection_for_session', lambda authority, session_id: selected)
        monkeypatch.setattr('hermes_cli.model_selection_guards.selection_warnings', lambda *args, **kwargs: [])
        applied = _request(call, viewer, 'groups.prepare_model', room_id='room', member_id='helper', apply_selection=True)
        assert 'result' in applied, applied
        assert applied['result']['selection'] == selected
        policy = policy_for_source(runner, target.sessions[sid].source)
        assert policy.current_model(target) == 'chosen-model'
        assert policy.config(target)['model']['provider'] == 'custom:relay'
        assert (homes['helper'] / 'config.yaml').read_text() == config
        assert local_receipt(target.db, sid)['policy']['request_json'] == original['policy']['request_json']
        call(viewer.close())
