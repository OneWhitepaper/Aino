"""A group member has its own managed credential, under the current room owner's grant."""
import json
from types import SimpleNamespace

import pytest

from tests.gateway.test_hosted_group_members import _gateway, _members


OWNER = {'platform_origin': 'http://127.0.0.1:17321', 'user_id': 'account-one'}


class Peer:
    def __init__(self, user='desktop'):
        self.auth_identity = {'provider': 'local', 'user_id': user}


def _connection(authority, *, user='desktop', scope='host', capabilities=None):
    from gateway.session_controls import AuthorityConnection
    identity = {'provider': 'local', 'user_id': user, 'profile_scope': scope}
    if capabilities is not None:
        identity['capabilities'] = capabilities
    return AuthorityConnection(authority, Peer(user), identity)


def _request(call, connection, method, **params):
    return call(connection.dispatch({'id': method, 'method': method, 'params': params}))


def _prepare(call, viewer, member='helper', **params):
    return _request(call, viewer, 'groups.prepare_model', room_id='room', member_id=member,
                    model_id='catalog-one', owner=OWNER, **params)


def _bind(call, controller, prepared, *, owner=OWNER):
    route = {'profile': prepared['profile'], 'session_id': prepared['session_id']}
    claim = _request(call, controller, 'session.claim_managed_model', **route, owner=owner,
                     model_id=prepared['model_id'], session_ticket=prepared['session_ticket'])
    assert 'result' in claim, claim
    bound = _request(call, controller, 'session.bind_managed_model', **route, owner=owner,
                     model_id=prepared['model_id'], binding_revision=claim['result']['binding_revision'],
                     credential_id='group-device', credential_type='device', credential_version=1,
                     api_key='group-only-secret', base_url=owner['platform_origin'] + '/v1',
                     expires_at=None, model='wire-model', api_mode='chat_completions',
                     capabilities={'tools': True, 'vision': False, 'reasoning': False}, context_window=32000)
    assert bound.get('result', {}).get('bound'), bound
    return route, claim['result']['binding_revision']


@pytest.mark.parametrize('member', ['default', 'helper'])
@pytest.mark.parametrize('source_profile', ['default', 'helper'])
def test_group_prepares_exact_hosted_session_and_binds_across_renderer_and_native_peers(tmp_path, monkeypatch, member, source_profile):
    from gateway.session_authorities import owner_scope
    from gateway.session_platform_model import binding_key, managed_state
    from gateway.session_policy import policy_for_source
    from gateway.run_turn_prepare import _resolve_policy_agent_runtime
    from hermes_state_local import local_receipt
    from tui_gateway.hosted_room_driver import HostedRoomBinding
    from tui_gateway.managed_model_runtime import get_registry

    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        authority = runner.session_authorities.for_home(homes[source_profile])
        viewer, native = _connection(runner.session_authority), _connection(runner.session_authority)
        create = _request(call, viewer, 'groups.create', profile=source_profile,
                          room_id='room', name='Room', members=_members('default', 'helper'))
        assert 'result' in create, create
        prepared = _prepare(call, viewer, member, profile=source_profile)
        assert 'result' in prepared, prepared
        prepared = prepared['result']
        target = runner.session_authorities.for_home(homes[member])
        sid = prepared['session_id']
        assert prepared['profile'] == member
        rpc = authority.hosted_room_service._resolve_member_transport(
            HostedRoomBinding('room', create['result']['room']['authority_gateway_id'], 1),
            {'payload': {'target_member_id': member, 'target_profile': member}})
        assert rpc.create(profile=member, source='bot_room', title='Group: room')['session_id'] == sid
        before = local_receipt(target.db, sid)
        assert before['policy']['source'] == 'bot_room'
        route, revision = _bind(call, native, prepared)
        binding = get_registry().get(binding_key(target, sid), managed_state(target, sid))
        assert binding is not None and binding.api_key == 'group-only-secret'
        bot = _request(call, viewer, 'session.create', profile=member, request_id='independent-bot-chat',
                       source='gui', cwd=str(tmp_path), toolsets=[], model_source='aino', model_id='bot-model')
        assert 'result' in bot, bot
        bot_sid = bot['result']['session_id']
        bot_ticket = _request(call, viewer, 'session.managed_model_ticket', profile=member,
                              session_id=bot_sid, owner=OWNER, model_id='bot-model')['result']
        _bind(call, native, {**bot_ticket, 'profile': member, 'session_id': bot_sid, 'model_id': 'bot-model'})
        bot_binding = get_registry().get(binding_key(target, bot_sid))
        assert bot_sid != sid and bot_binding is not binding

        with owner_scope(target):
            live = target.sessions[sid]
            model, runtime = _resolve_policy_agent_runtime(runner, policy_for_source(runner, live.source), source=live.source)
        assert model == 'wire-model' and runtime['api_key']() == 'group-only-secret'

        # Every group send prepares members again, including ones already running.
        original_handle = target._handle
        monkeypatch.setattr(target, '_handle', lambda ref: SimpleNamespace(execution_state='running'))
        again = _prepare(call, viewer, member, profile=source_profile)
        assert 'result' in again, again
        assert get_registry().get(binding_key(target, sid)) is binding
        assert get_registry().get(binding_key(target, bot_sid)) is bot_binding
        assert local_receipt(target.db, sid) == before
        monkeypatch.setattr(target, '_handle', original_handle)

        if member != source_profile:
            denied = _request(call, native, 'session.resume', **route)
            assert denied['error']['data']['reason'] == 'permission_denied', denied
        forged = _connection(runner.session_authority, user='another-os-user')
        denied = _request(call, forged, 'session.clear_managed_model', **route, binding_revision=revision)
        assert 'error' in denied, denied
        assert get_registry().get(binding_key(target, sid)) is binding

        # A current owner/member/epoch check fences both future native actions and runtime reads.
        authority.db._execute_write(lambda conn: conn.execute(
            'UPDATE state_meta SET value=? WHERE key=?', ('replacement-owner', 'gateway.hosted.owner.v1:room')))
        denied = _request(call, native, 'session.managed_model_status', **route, owner=OWNER,
                          model_id='catalog-one', binding_revision=revision, credential_version=1)
        assert 'error' in denied, denied
        from hermes_state_runtime import RuntimeStoreError
        with pytest.raises(RuntimeStoreError, match='managed_binding_forbidden'):
            managed_state(target, sid)
        with pytest.raises(RuntimeStoreError, match='managed_binding_forbidden'):
            runtime['api_key']()
        assert get_registry().get(binding_key(target, sid)) is None
        assert get_registry().get(binding_key(target, bot_sid)) is bot_binding
        for connection in (viewer, native, forged):
            call(connection.close())


@pytest.mark.parametrize('refusal', ['owner', 'capability', 'profile_scope', 'unserved', 'remote', 'account', 'member', 'epoch', 'retiring', 'retired'])
def test_group_prepare_and_native_claim_refuse_foreign_or_stale_grants(tmp_path, monkeypatch, refusal):
    with _gateway(tmp_path, monkeypatch, served=('helper',), unserved=('parked',)) as (runner, homes, call):
        authority = runner.session_authority
        viewer = _connection(authority)
        created = _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
        assert 'result' in created, created
        callers = {'owner': {'user': 'foreign'}, 'capability': {'capabilities': ['session:read']},
                   'profile_scope': {'scope': 'profile'}}
        caller = _connection(authority, **callers[refusal]) if refusal in callers else viewer
        replacements = {'unserved': {'profile': 'parked'}, 'member': {'member_id': 'replacement'},
                        'remote': {'target': {'kind': 'peer', 'peer_id': 'remote', 'profile': 'helper'}}}
        if refusal in {'retiring', 'retired'}:
            setattr(runner.session_authorities.for_home(homes['helper']), refusal, True)
        if refusal in replacements:
            members = _members('default', 'helper')
            members[1].update(replacements[refusal])
            authority.db._execute_write(lambda conn: conn.execute(
                'UPDATE hosted_rooms SET members_json=? WHERE room_id=?', (json.dumps(members), 'room')))
        prepared = _prepare(call, caller)
        if refusal in {'account', 'epoch'}:
            assert 'result' in prepared, prepared
            selected = prepared['result']
            if refusal == 'epoch':
                authority.db._execute_write(lambda conn: conn.execute(
                    'UPDATE hosted_rooms SET authority_epoch=authority_epoch+1 WHERE room_id=?', ('room',)))
            denied = _request(call, _connection(authority), 'session.claim_managed_model',
                              profile=selected['profile'], session_id=selected['session_id'],
                              owner={**OWNER, 'user_id': 'wrong-account'} if refusal == 'account' else OWNER,
                              model_id=selected['model_id'], session_ticket=selected['session_ticket'])
            assert 'error' in denied, denied
        else:
            assert 'error' in prepared, prepared
        call(viewer.close())
        if caller is not viewer:
            call(caller.close())


@pytest.mark.parametrize('status', ['queued', 'started', 'unknown'])
@pytest.mark.parametrize('change', ['model', 'account'])
def test_group_model_preparation_keeps_pending_input_bytes_and_refuses_active_selection_changes(tmp_path, monkeypatch, status, change):
    from gateway.session_platform_model import binding_key
    from hermes_state_local import local_receipt
    from hermes_state_runtime import admit_session_input
    from tui_gateway.managed_model_runtime import get_registry

    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        source = runner.session_authority
        target = runner.session_authorities.for_home(homes['helper'])
        viewer, native = _connection(source), _connection(source)
        assert 'result' in _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
        prepared = _prepare(call, viewer)['result']
        _bind(call, native, prepared)
        sid = prepared['session_id']
        policy = local_receipt(target.db, sid)
        admit_session_input(target.db, epoch=target.epoch, principal_id=policy['principal_id'],
                            session_id=sid, request_id='exact-pending-identity',
                            payload={'text': '  exact @helper\n``` @all ```  ', 'frozen_recipients': ['helper']})
        target.db._execute_write(lambda conn: conn.execute(
            'UPDATE session_admissions SET status=?,owner_epoch=?,generation=1 WHERE target_session_id=?',
            (status, target.epoch, sid)))

        def raw_inputs():
            with target.db._read_ctx() as conn:
                return [tuple(row) for row in conn.execute('SELECT * FROM session_admissions WHERE target_session_id=?', (sid,))]
        pending = raw_inputs()
        active = get_registry().get(binding_key(target, sid))
        assert 'result' in _prepare(call, viewer), 'the same selection is safe even while its turn runs'
        changed = _request(call, viewer, 'groups.prepare_model', room_id='room', member_id='helper',
                           model_id='catalog-two' if change == 'model' else 'catalog-one',
                           owner={**OWNER, 'user_id': 'account-two'} if change == 'account' else OWNER)
        if status == 'queued':
            assert 'result' in changed, changed
        else:
            expected = 'session_busy' if status == 'started' else 'unknown_execution'
            assert changed['error']['data']['reason'] == expected, changed
            assert local_receipt(target.db, sid) == policy
            assert get_registry().get(binding_key(target, sid)) is active
        assert raw_inputs() == pending
        assert local_receipt(target.db, sid)['policy']['request_json'] == policy['policy']['request_json']
        call(viewer.close())
        call(native.close())
