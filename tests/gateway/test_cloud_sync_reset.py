"""A local /new boundary survives remote changes on either neighboring compression group."""
import asyncio
import json

import pytest

from hermes_state import SessionDB
from tests.gateway.fixtures.local_recovery_probe import rpc, websocket
from tests.gateway.test_cloud_sync_compression import device, receipt, submit, compress
from tests.hermes_cli.test_cloud_sync import Cloud, sync


def sync_complete(home, cloud):
    for _ in range(8):
        result = sync(home, cloud)
        assert not result['status']['issues'], result
        if result['status']['state'] == 'synced':
            return
    pytest.fail('cloud sync did not finish')


async def reset(ws, home, sid):
    with SessionDB(home / 'state.db') as db:
        row = db.get_session(sid)
    result = await rpc(ws, 'session.mutate', session_id=sid, request_id='local-new',
                       expected_revision=row['runtime_revision'], expected_generation=row['runtime_generation'],
                       operation='reset', payload={})
    assert 'result' in result, result
    return result['result']['target_session_id']


@pytest.mark.platforms('linux', 'macos')
@pytest.mark.parametrize('older_group', [False, True], ids=['after-reset', 'before-retained-reset'])
def test_cloud_compression_preserves_local_reset_boundary_and_restart(tmp_path, older_group):
    with device(tmp_path / 'a') as (a, peer, boot_a), device(tmp_path / 'b') as (b, _peer_b, boot_b):
        cloud = Cloud()
        with boot_a() as (_, desc_a), boot_b() as (_, desc_b):
            async def exchange():
                async with websocket(a, desc_a) as wa, websocket(b, desc_b) as wb:
                    created = await rpc(wa, 'session.create', request_id='reset-sync', source='gui', toolsets=[])
                    sid = created['result']['session_id']
                    for i in range(4):
                        await submit(wa, a, sid, f'BEFORE_RESET_{i}')
                    if older_group:
                        sync_complete(a, cloud)
                        sync_complete(b, cloud)
                        assert 'result' in await rpc(wb, 'session.resume', session_id=sid)
                    reset_id = await reset(wa, a, sid)
                    with SessionDB(a / 'state.db') as db:
                        reset_time = db.get_session(sid)['ended_at']
                    for i in range(4):
                        await submit(wa, a, sid, f'AFTER_RESET_{i}')
                    local_receipt = receipt(a, sid)
                    sync_complete(a, cloud)
                    sync_complete(b, cloud)
                    target = sid if older_group else reset_id
                    assert 'result' in await rpc(wb, 'session.resume', session_id=target)
                    await submit(wb, b, target, 'REMOTE_CONTINUATION')
                    remote_tip = await compress(wb, b, target, 'remote-compress')
                    await submit(wb, b, target, 'REMOTE_AFTER_COMPRESSION')
                    sync_complete(b, cloud)
                    sync_complete(a, cloud)
                    expected_tip = reset_id if older_group else remote_tip
                    updated = receipt(a, sid)
                    expected_lineage = [sid, remote_tip, reset_id] if older_group else [sid, reset_id, remote_tip]
                    assert updated['lineage'] == expected_lineage
                    assert updated['entry']['session_id'] == expected_tip
                    assert updated['policy'] == local_receipt['policy']
                    assert updated['principal_id'] == local_receipt['principal_id']
                    parent = remote_tip if older_group else sid
                    with SessionDB(a / 'state.db') as db:
                        child, previous = db.get_session(reset_id), db.get_session(parent)
                        assert child['parent_session_id'] == parent
                        assert json.loads(child['model_config'])['_reset_from'] == parent
                        assert previous['end_reason'] == 'session_reset'
                        assert previous['ended_at'] == reset_time
                    resumed = await rpc(wa, 'session.resume', session_id=sid)
                    assert 'result' in resumed, resumed
                    await submit(wa, a, sid, 'WARM_AFTER_SYNC')
                    return sid, expected_tip, expected_lineage
            sid, tip, lineage = asyncio.run(exchange())
        with boot_a() as (_, desc_a):
            async def restarted():
                async with websocket(a, desc_a) as ws:
                    resumed = await rpc(ws, 'session.resume', session_id=sid)
                    assert 'result' in resumed, resumed
                    await submit(ws, a, sid, 'RESTART_AFTER_SYNC')
                    assert receipt(a, sid)['lineage'] == lineage
                    assert receipt(a, sid)['entry']['session_id'] == tip
                    request = next(r for r in reversed(peer.requests) if any(
                        m.get('content') == 'RESTART_AFTER_SYNC' for m in r['messages']))
                    content = json.dumps(request['messages'])
                    assert ('REMOTE_AFTER_COMPRESSION' in content) is not older_group
                    assert 'BEFORE_RESET_0' not in content
                    if older_group:
                        assert 'AFTER_RESET_3' in content
                    sync_complete(a, cloud)
            asyncio.run(restarted())
