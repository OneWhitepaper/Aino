"""A hosted activity read is fenced to its admission, not its differently numbered room generation."""
from gateway.hosted_room_driver import TaskIdentity
from gateway.session_hosted_rpc import HostedRoomAuthorityRPC
from hermes_state_runtime import claim_session_input


def test_info_returns_only_its_current_admission_activity_and_clears_on_execution_exit(hosted_owner):
    authority, _loop, principal, _agent = hosted_owner
    coords = {'profile': 'default', 'source': 'bot_room'}
    rpcs = [HostedRoomAuthorityRPC(authority, _loop, room_id=room, member_id='member', profile='default',
            principal=principal, authorize=lambda *args: True) for room in ('first', 'second')]
    rows = []
    for rpc, tool in zip(rpcs, ('read_file', 'terminal')):
        sid = rpc.create(**coords, title='Group: ' + rpc.room_id)['session_id']
        rpc.submit(**coords, session_id=sid, prompt='work', task=TaskIdentity(rpc.room_id, 'task', 'thread', 'turn'),
                   execution_generation=17, on_terminal=lambda receipt: None)
        row = claim_session_input(authority.db, epoch=authority.epoch, session_id=sid)
        live = authority.sessions[sid]
        authority._stamp_claim(rpc.ref, live, row)
        authority.publish_execution(sid, row['generation'], 'tool.start', {'tool_id': 'call', 'name': tool, 'args': {'private': 'not published'}})
        rows.append((sid, row))
    first = rpcs[0].info(**coords, session_id=rows[0][0])
    second = rpcs[1].info(**coords, session_id=rows[1][0])
    assert first['execution_generation'] == 17
    assert rows[0][1]['generation'] != first['execution_generation']
    assert first['activity'] == 'reading'
    assert second['activity'] == 'running_command'
    assert 'private' not in repr(first)
    authority.executing.pop(rows[0][0])
    assert 'activity' not in rpcs[0].info(**coords, session_id=rows[0][0])
    assert rpcs[1].info(**coords, session_id=rows[1][0])['activity'] == 'running_command'
