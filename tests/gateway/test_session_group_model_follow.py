"""A group member can leave its Aino selection and follow its own profile again."""
import json

import pytest

from tests.gateway.test_session_group_models import (
    OWNER, _bind, _connection, _gateway, _members, _prepare, _request,
)


def _follow(call, viewer, member='helper', **params):
    return _request(call, viewer, 'groups.prepare_model', room_id='room', member_id=member,
                    follow_profile_config=True, **params)


def _pending_inputs(authority, sid):
    with authority.db._read_ctx() as conn:
        return [tuple(row) for row in conn.execute(
            'SELECT * FROM session_admissions WHERE target_session_id=? ORDER BY admission_id', (sid,))]


@pytest.mark.parametrize('member', ['default', 'helper'])
@pytest.mark.parametrize('provider,endpoint,providers', [
    ('openai', 'https://api.openai.com/v1', {}),
    ('custom:external-fixture', 'http://127.0.0.1:9/v1', {
        'external-fixture': {'name': 'external-fixture', 'base_url': 'http://127.0.0.1:9/v1'}}),
])
def test_group_can_release_aino_and_follow_current_profile_without_rewriting_pending_input(
        tmp_path, monkeypatch, member, provider, endpoint, providers):
    from gateway.session_platform_model import binding_key, selection_for_policy
    from gateway.session_policy import policy_for_source, restore_policy
    from hermes_state_local import local_receipt
    from hermes_state_runtime import admit_session_input
    from tui_gateway.managed_model_runtime import get_registry

    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        source = runner.session_authority
        target = runner.session_authorities.for_home(homes[member])
        viewer, native = _connection(source), _connection(source)
        created = _request(call, viewer, 'groups.create', room_id='room', name='Room',
                           members=_members('default', 'helper'))
        assert 'result' in created, created
        prepared = _prepare(call, viewer, member)
        assert 'result' in prepared, prepared
        prepared = prepared['result']
        _bind(call, native, prepared)
        sid = prepared['session_id']
        key = binding_key(target, sid)
        assert get_registry().get(key) is not None
        original = local_receipt(target.db, sid)
        admit_session_input(target.db, epoch=target.epoch, principal_id=original['principal_id'],
                            session_id=sid, request_id='exact-follow-pending-identity',
                            payload={'text': '  exact @helper\n``` @all ```  ',
                                     'frozen_recipients': [member]})
        pending = _pending_inputs(target, sid)
        config = {'model': {'default': 'profile-model', 'provider': provider, 'base_url': endpoint},
                  'providers': providers, 'platform_toolsets': {'cli': []}}
        (homes[member] / 'config.yaml').write_text(json.dumps(config))

        result = _follow(call, viewer, member)
        assert 'result' in result, result
        assert result['result']['session_id'] == sid
        assert result['result']['profile'] == member
        assert result['result']['follow_profile_config'] is True
        assert 'session_ticket' not in result['result']
        saved = local_receipt(target.db, sid)
        policy = restore_policy(saved['policy'])
        assert policy.source == 'bot_room' and policy.follows_profile
        assert policy.current_model(target) == 'profile-model'
        current = policy.config(target, secrets=False)
        assert current['model']['provider'] == provider
        assert current['model']['base_url'] == endpoint
        assert 'model_source' not in current['model'] and 'model_id' not in current['model']
        assert selection_for_policy(policy) is None
        assert policy_for_source(runner, target.sessions[sid].source) == policy
        assert saved['request_id'] == original['request_id']
        assert saved['policy']['request_json'] == original['policy']['request_json']
        assert _pending_inputs(target, sid) == pending
        assert get_registry().get(key) is None
        assert getattr(target.sessions[sid], 'group_model_grant', None) is None

        # Following remains live after this reset; it must not freeze today's route.
        config['model']['default'] = 'next-profile-model'
        config['model']['base_url'] = 'http://127.0.0.1:8/v1'
        (homes[member] / 'config.yaml').write_text(json.dumps(config))
        assert policy.current_model(target) == 'next-profile-model'
        assert policy.config(target, secrets=False)['model']['base_url'] == 'http://127.0.0.1:8/v1'
        call(viewer.close())
        call(native.close())


@pytest.mark.parametrize('member', ['default', 'helper'])
def test_following_an_uncreated_external_member_does_not_create_a_session(tmp_path, monkeypatch, member):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        source = runner.session_authority
        target = runner.session_authorities.for_home(homes[member])
        viewer = _connection(source)
        created = _request(call, viewer, 'groups.create', room_id='room', name='Room',
                           members=_members('default', 'helper'))
        assert 'result' in created, created
        (homes[member] / 'config.yaml').write_text(json.dumps({
            'model': {'default': 'external-model', 'provider': 'custom',
                      'base_url': 'http://127.0.0.1:9/v1'},
            'platform_toolsets': {'cli': []}}))
        with target.db._read_ctx() as conn:
            original_ids = [row[0] for row in conn.execute('SELECT id FROM sessions ORDER BY id')]
        live_ids = set(target.sessions)
        result = _follow(call, viewer, member)
        assert 'result' in result, result
        assert result['result']['profile'] == member
        assert result['result']['follow_profile_config'] is True
        assert target.db.get_session(result['result']['session_id']) is None
        with target.db._read_ctx() as conn:
            assert [row[0] for row in conn.execute('SELECT id FROM sessions ORDER BY id')] == original_ids
        assert set(target.sessions) == live_ids
        call(viewer.close())


@pytest.mark.parametrize('params', [
    {'follow_profile_config': False},
    {'follow_profile_config': True, 'owner': OWNER},
    {'follow_profile_config': True, 'model_id': 'catalog-one'},
    {'follow_profile_config': True, 'owner': OWNER, 'model_id': 'catalog-one'},
])
def test_group_profile_following_rejects_false_or_mixed_selection_fields(tmp_path, monkeypatch, params):
    from gateway.session_platform_model import binding_key
    from hermes_state_local import local_receipt
    from tui_gateway.managed_model_runtime import get_registry

    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        source = runner.session_authority
        target = runner.session_authorities.for_home(homes['helper'])
        viewer, native = _connection(source), _connection(source)
        created = _request(call, viewer, 'groups.create', room_id='room', name='Room',
                           members=_members('default', 'helper'))
        assert 'result' in created, created
        prepared = _prepare(call, viewer)
        assert 'result' in prepared, prepared
        prepared = prepared['result']
        _bind(call, native, prepared)
        sid = prepared['session_id']
        original = local_receipt(target.db, sid)
        binding = get_registry().get(binding_key(target, sid))
        result = _request(call, viewer, 'groups.prepare_model', room_id='room', member_id='helper', **params)
        assert result['error']['data']['reason'] == 'invalid_params', result
        assert local_receipt(target.db, sid) == original
        assert get_registry().get(binding_key(target, sid)) is binding
        call(viewer.close())
        call(native.close())
