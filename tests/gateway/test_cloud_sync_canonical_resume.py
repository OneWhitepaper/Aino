"""A real canonical owner and worker consume synchronized history before the next model call."""
import asyncio
import json

import pytest

from hermes_state import SessionDB
from tests.gateway.fixtures.local_recovery_probe import rpc, websocket
from tests.gateway.test_session_busy_controls import owner, settled
from tests.hermes_cli.test_cloud_sync import Cloud, seed, sync


@pytest.mark.platforms('linux', 'macos')
@pytest.mark.parametrize('worker', [False, True], ids=['ordinary', 'managed-worker'])
def test_canonical_resume_and_submit_read_replaced_history(tmp_path, worker):
    with owner(tmp_path) as (home, peer, desc):
        async def probe():
            async with websocket(home, desc) as ws:
                created = await rpc(ws, 'session.create', request_id='cloud-warm', source='gui',
                                    toolsets=[], ignore_user_config=worker,
                                    model='controls-fixture', provider='custom',
                                    base_url=f'http://127.0.0.1:{peer.server_port}/v1', api_key='loopback-only')
                assert 'result' in created, created
                sid = created['result']['session_id']
                warm = await rpc(ws, 'prompt.submit', session_id=sid, input_id='warm', text='LOCAL_WARM')
                assert 'result' in warm, warm
                await settled(home)
                cloud = Cloud()
                remote = tmp_path / 'remote'
                sync(home, cloud)
                sync(remote, cloud)
                with SessionDB(remote / 'state.db') as db:
                    # Same number of rows: a count-only cache check cannot detect this replacement.
                    db._execute_write(lambda conn: conn.execute(
                        "UPDATE messages SET content='REMOTE_REPLACEMENT' WHERE session_id=? AND role='assistant'", (sid,)))
                sync(remote, cloud)
                sync(home, cloud)
                resumed = await rpc(ws, 'session.resume', session_id=sid)
                assert 'REMOTE_REPLACEMENT' in json.dumps(resumed['result']['messages']), resumed
                submitted = await rpc(ws, 'prompt.submit', session_id=sid, input_id='after-sync', text='CONTINUE_SYNC')
                assert 'result' in submitted, submitted
                await settled(home)
                inference = next(request for request in reversed(peer.requests)
                                 if any(m.get('content') == 'CONTINUE_SYNC' for m in request['messages']))
                assert any(m.get('content') == 'REMOTE_REPLACEMENT' for m in inference['messages']), inference
                assert not any(m.get('content') == 'CONTROL_ACK' for m in inference['messages']), inference
                finished = await rpc(ws, 'session.resume', session_id=sid)
                assert any(m.get('content') == 'CONTROL_ACK' for m in finished['result']['messages'])
        asyncio.run(probe())


@pytest.mark.platforms('linux', 'macos')
def test_cold_imported_conversation_is_adopted_and_submitted_by_canonical_owner(tmp_path):
    with owner(tmp_path) as (home, peer, desc):
        remote = tmp_path / 'remote'
        with seed(remote, text='IMPORTED_FIRST_USER', sid='imported-conversation') as db:
            db._execute_write(lambda conn: conn.execute(
                "UPDATE sessions SET model='controls-fixture',model_config='{}' WHERE id='imported-conversation'"))
        cloud = Cloud()
        sync(remote, cloud)
        sync(home, cloud)
        async def probe():
            async with websocket(home, desc) as ws:
                resumed = await rpc(ws, 'session.resume', session_id='imported-conversation')
                assert 'result' in resumed, resumed
                assert 'IMPORTED_FIRST_USER' in json.dumps(resumed['result']['messages'])
                submitted = await rpc(ws, 'prompt.submit', session_id='imported-conversation',
                                      input_id='cold-continue', text='COLD_CONTINUE')
                assert 'result' in submitted, submitted
                await settled(home)
                inference = next(request for request in reversed(peer.requests)
                                 if any(m.get('content') == 'COLD_CONTINUE' for m in request['messages']))
                assert any(m.get('content') == 'IMPORTED_FIRST_USER' for m in inference['messages'])
                assert any(m.get('content') == 'first answer' for m in inference['messages'])
                finished = await rpc(ws, 'session.resume', session_id='imported-conversation')
                assert any(m.get('content') == 'CONTROL_ACK' for m in finished['result']['messages'])
        asyncio.run(probe())
