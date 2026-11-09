"""Hosted members keep one recoverable policy and follow their owning profile."""
import json

import pytest


def _rpc(hosted_owner):
    from gateway.session_hosted_rpc import HostedRoomAuthorityRPC
    authority, loop, principal, _ = hosted_owner
    return HostedRoomAuthorityRPC(authority, loop, room_id='room', member_id='member',
                                  profile='default', principal=principal, authorize=lambda *args: True)


def _receipt(authority, sid):
    from hermes_state_local import local_receipt
    return local_receipt(authority.db, sid)


def _seed_empty_receipt(rpc, *, tamper=None):
    """The old create committed this policy before its immediate restore failed."""
    from gateway.config import Platform
    from gateway.session_local_recovery import local_adapter_map
    from hermes_state_local import POLICY_PREFIX
    sid = rpc.create(profile='default', title='Group: room', source='bot_room')['session_id']
    receipt = _receipt(rpc.authority, sid)
    receipt['policy']['model'] = ''
    receipt['policy']['request_json'] = '{"source": "gui"}'
    config = json.loads(receipt['policy']['config_json'])
    config['model'] = {'default': '', 'provider': ''}
    config.pop('follow_adopted', None)
    receipt['policy']['config_json'] = json.dumps(config)
    if tamper:
        tamper(receipt)
    encoded = json.dumps(receipt)

    def write(conn):
        conn.execute('UPDATE state_meta SET value=? WHERE key=?', (encoded, POLICY_PREFIX + sid))
        conn.execute("UPDATE sessions SET model='' WHERE id=?", (sid,))
    rpc.authority.db._execute_write(write)
    live = rpc.authority.sessions.pop(sid)
    local_adapter_map(rpc.authority)[Platform.LOCAL].policies.pop(live.source.chat_id)
    return sid, receipt


def test_new_room_without_a_runtime_model_commits_a_recoverable_following_policy(hosted_owner, monkeypatch):
    from gateway import run
    from gateway.session_policy import restore_policy
    monkeypatch.setattr(run, '_load_gateway_config', lambda *args: {'platform_toolsets': {'cli': []}})
    monkeypatch.setattr(run, '_resolve_gateway_model', lambda cfg: '')
    rpc = _rpc(hosted_owner)
    sid = rpc.create(profile='default', title='Group: room', source='bot_room')['session_id']
    policy = restore_policy(_receipt(rpc.authority, sid)['policy'])
    assert policy.model is None and policy.follows_profile
    monkeypatch.setattr(run, '_load_gateway_config', lambda *args: {
        'model': {'default': 'member-model', 'provider': 'custom:member'},
        'agent': {'disabled_toolsets': ['browser']}})
    monkeypatch.setattr(run, '_resolve_gateway_model', lambda cfg: cfg.get('model', {}).get('default', ''))
    config, model = policy.effective(rpc.authority, secrets=False)
    assert model == 'member-model'
    assert config['model']['provider'] == 'custom:member'
    assert set(config['agent']['disabled_toolsets']) == {'browser', 'clarify'}


@pytest.mark.parametrize('status', ['queued', 'started', 'unknown'])
def test_old_empty_room_policy_recovers_same_id_without_rewriting_pending_input(hosted_owner, status):
    from gateway.hosted_room_driver import TaskIdentity
    from hermes_state_runtime import list_session_admissions
    from gateway.session_policy import restore_policy
    rpc = _rpc(hosted_owner)
    sid = rpc.create(profile='default', title='Group: room', source='bot_room')['session_id']
    task = TaskIdentity('room', 'task', 'thread', 'turn')
    rpc.submit(profile='default', session_id=sid, source='bot_room', prompt='exact @member prompt',
               task=task, execution_generation=1, on_terminal=lambda result: None)
    rpc.authority.db._execute_write(lambda conn: conn.execute(
        'UPDATE session_admissions SET status=?,owner_epoch=?,generation=1 WHERE target_session_id=?',
        (status, rpc.authority.epoch, sid)))
    before_admissions = list_session_admissions(rpc.authority.db, session_id=sid, pending_only=False)
    sid, before = _seed_empty_receipt(rpc)
    resumed = rpc.resume(profile='default', session_id=sid, source='bot_room')
    after = _receipt(rpc.authority, sid)
    assert resumed['session_id'] == sid
    assert before['request_id'] == after['request_id'] == rpc.creation_id
    assert before['policy']['request_json'] == after['policy']['request_json']
    assert list_session_admissions(rpc.authority.db, session_id=sid, pending_only=False) == before_admissions
    policy = restore_policy(after['policy'])
    assert policy.model is None and policy.follows_profile
    assert rpc.create(profile='default', title='Group: room', source='bot_room')['session_id'] == sid


@pytest.mark.parametrize('tamper', [
    lambda receipt: receipt.update(request_id='another-request'),
    lambda receipt: receipt.update(principal_id='another-owner'),
    lambda receipt: receipt['policy'].update(source='gui', platform='desktop'),
    lambda receipt: receipt['policy'].update(request_json='{"source":"gui","model":"other"}'),
    lambda receipt: receipt['entry'].update(session_key='another-route'),
])
def test_empty_policy_repair_refuses_any_other_creation_or_owner(hosted_owner, tamper):
    from hermes_state_runtime import RuntimeStoreError
    rpc = _rpc(hosted_owner)
    sid, before = _seed_empty_receipt(rpc, tamper=tamper)
    with pytest.raises(RuntimeStoreError):
        rpc.resume(profile='default', session_id=sid, source='bot_room')
    assert _receipt(rpc.authority, sid) == before
