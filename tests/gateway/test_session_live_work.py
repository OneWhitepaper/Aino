"""Native collaboration discovery preserves exact room provenance without restoring producers."""
import json
from types import SimpleNamespace

import pytest

from gateway.session_authority import SessionAuthority
from gateway.session_controls import AuthorityConnection
from hermes_state import SessionDB
from hermes_state_runtime import begin_runtime_epoch


@pytest.fixture
def owner(tmp_path, monkeypatch):
    from gateway.hosted_rooms import create_room, local_authority_gateway_id
    from gateway.session_hosted_rpc import HostedRoomAuthorityRPC
    from gateway.session_hosted_service import CanonicalHostedRoomService
    from tools import delegate_tool_registry as registry

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setattr(registry, '_active_subagents', {})
    with SessionDB(tmp_path / 'state.db') as db:
        runner = SimpleNamespace(_draining=False)
        authority = SessionAuthority(runner, profile_id=str(tmp_path), instance_id='owner', db=db,
                                     epoch=begin_runtime_epoch(db, instance_id='owner'))
        runner.session_authority = authority
        connection = AuthorityConnection(authority, object(), {'user_id': 'alice'})
        service = authority.hosted_room_service = CanonicalHostedRoomService(authority, None)
        owner = connection.actor.subject
        service.authorize_room(owner, 'design-room', create=True)
        create_room(db.db_path, room_id='design-room', name='设计讨论',
                    authority_gateway_id=local_authority_gateway_id(), members=[
                        {'member_id': 'designer', 'profile': 'default', 'handle': 'Designer'},
                        {'member_id': 'reviewer', 'profile': 'other', 'handle': 'Reviewer'}])
        rpc = HostedRoomAuthorityRPC(authority, None, room_id='design-room', member_id='designer',
                                     profile='default', principal=connection.actor, authorize=lambda *args: True)
        service.member_rpcs['design-room', 'designer', 'default', owner, str(tmp_path)] = rpc
        db.create_session(rpc.ref.session_id, source='bot_room')
        db.create_session('ordinary-chat', source='gui')
        registry._active_subagents.update({
            'room-child': {'subagent_id': 'room-child', 'depth': 0, 'status': 'running',
                           'owner_agent_session_id': rpc.ref.session_id, 'goal': '检查设计'},
            'ordinary-child': {'subagent_id': 'ordinary-child', 'depth': 0, 'status': 'running',
                               'owner_agent_session_id': 'ordinary-chat', 'goal': '检查代码'},
            'foreign-child': {'subagent_id': 'foreign-child', 'depth': 0,
                             'owner_agent_session_id': 'not-in-this-profile', 'goal': 'PRIVATE OTHER PROFILE'},
        })
        yield connection, service, rpc, db


async def roster(connection, **params):
    response = await connection.dispatch({'id': 1, 'method': 'subagent.roster', 'params': params})
    assert 'error' not in response, response
    return response['result']['sessions']


@pytest.mark.asyncio
async def test_native_roster_names_the_exact_group_and_never_opens_hidden_plumbing(owner):
    connection, service, rpc, db = owner
    before = db._conn.total_changes
    rows = await roster(connection)
    group = next(row for row in rows if row['session_id'] == rpc.ref.session_id)
    assert group['source'] == {'kind': 'bot_room', 'room_id': 'design-room', 'room_name': '设计讨论', 'profile': 'default'}
    assert [w['goal'] for w in group['workers']] == ['检查设计']
    assert {row['session_id'] for row in rows} == {rpc.ref.session_id, 'ordinary-chat'}
    assert db._conn.total_changes == before
    assert not connection.authority.sessions, 'a read must not restore internal member sessions'

    # A cold service has no exact member binding. Keep ordinary unknown-owner work usable while
    # refusing to invent a normal chat for the internal room producer.
    service.member_rpcs.clear()
    assert [row['session_id'] for row in await roster(connection)] == ['ordinary-chat']


@pytest.mark.asyncio
async def test_native_roster_rejects_foreign_room_owner_removed_member_and_restricted_grants(owner):
    connection, _, _, db = owner
    foreign = AuthorityConnection(connection.authority, object(), {'user_id': 'bob'})
    assert [row['session_id'] for row in await roster(foreign)] == ['ordinary-chat']
    restricted = AuthorityConnection(connection.authority, object(), {
        'user_id': 'alice', 'capabilities': ['session:read']})
    response = await restricted.dispatch({'id': 2, 'method': 'subagent.roster', 'params': {}})
    assert response['error']['message'] == 'permission_denied'
    response = await connection.dispatch({'id': 3, 'method': 'subagent.roster', 'params': {'profile': 'foreign'}})
    assert response['error']['message'] == 'profile_mismatch'
    with db._lock:
        db._conn.execute("UPDATE hosted_rooms SET members_json=? WHERE room_id='design-room'", (json.dumps([
            {'member_id': 'replacement', 'profile': 'default', 'handle': 'Replacement'},
            {'member_id': 'reviewer', 'profile': 'other', 'handle': 'Reviewer'}]),))
        db._conn.commit()
    assert [row['session_id'] for row in await roster(connection)] == ['ordinary-chat']


@pytest.mark.asyncio
async def test_group_source_uses_authority_profile_only_for_a_host_scoped_target_read(owner, tmp_path):
    from gateway.hosted_rooms import create_room, local_authority_gateway_id
    from gateway.session_authorities import SessionAuthorities
    from gateway.session_contract import SessionRef
    from gateway.session_hosted_service import CanonicalHostedRoomService
    from gateway.session_hosted_transport import HostedRoomOwnerRPC

    connection, service, rpc, _ = owner
    home = tmp_path / 'profiles' / 'room-owner'
    home.mkdir(parents=True)
    target = connection.authority
    registry = target.runner.session_authorities = SessionAuthorities(tmp_path)
    registry.add(tmp_path, target)
    with SessionDB(home / 'state.db') as db:
        db.create_session('not-in-this-profile', source='gui')
        source = SessionAuthority(target.runner, profile_id=str(home), instance_id='source', db=db,
                                  epoch=begin_runtime_epoch(db, instance_id='source'))
        registry.add(home, source, 'room-owner')
        source.hosted_room_service = other_service = CanonicalHostedRoomService(source, None)
        other_service.authorize_room(connection.actor.subject, 'design-room', create=True)
        create_room(db.db_path, room_id='design-room', name='跨机器人讨论',
                    authority_gateway_id=local_authority_gateway_id(), members=[
                        {'member_id': 'designer', 'profile': 'default', 'handle': 'Designer'},
                        {'member_id': 'reviewer', 'profile': 'room-owner', 'handle': 'Reviewer'}])
        # The source driver's existing cross-profile RPC retained this exact target ref after create.
        member_rpc = HostedRoomOwnerRPC(home=tmp_path, source_home=home, room_id='design-room',
                                       member_id='designer', profile='default')
        member_rpc.ref = SessionRef(str(tmp_path), rpc.ref.session_id)
        other_service.member_rpcs['design-room', 'designer', 'default', connection.actor.subject, str(tmp_path)] = member_rpc
        service.member_rpcs.clear()
        assert [row['session_id'] for row in await roster(connection)] == ['ordinary-chat']

        host = AuthorityConnection(target, object(), {'user_id': 'alice', 'profile_scope': 'host'})
        rows = await roster(host)
        group = next(row for row in rows if row['session_id'] == rpc.ref.session_id)
        assert group['source'] == {'kind': 'bot_room', 'room_id': 'design-room',
                                   'room_name': '跨机器人讨论', 'profile': 'room-owner'}
        # A member read never discloses the other profile's private stored sessions.
        assert all(row['session_id'] != 'not-in-this-profile' for row in rows)
