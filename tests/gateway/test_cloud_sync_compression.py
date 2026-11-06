"""Cross-device compression keeps the receiving canonical owner usable, including after restart."""
import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer

import pytest

from hermes_state import SessionDB
from hermes_state_local import POLICY_PREFIX
from tests.gateway.fixtures.local_recovery_probe import child_env, daemon, rpc, websocket
from tests.gateway.test_session_busy_controls import CorrectionModel, settled
from tests.hermes_cli.test_cloud_sync import Cloud, sync


@contextmanager
def device(root):
    home, user = root / 'state', root / 'user'
    home.mkdir(parents=True)
    user.mkdir()
    peer = ThreadingHTTPServer(('127.0.0.1', 0), CorrectionModel)
    peer.requests = []
    peer.blocked, peer.release = threading.Event(), threading.Event()
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{peer.server_port}/v1'
    (home / 'config.yaml').write_text(json.dumps({
        'gateway': {'multiplex_profiles': False},
        'model': {'provider': 'custom', 'default': 'controls-fixture', 'base_url': url},
        'auxiliary': {'title_generation': {'enabled': False}},
        'compression': {'in_place': False, 'protect_first_n': 0, 'protect_last_n': 2},
        'model_catalog': {'enabled': False}, 'models_dev': {'url': url + '/offline'},
    }))
    repo = Path(__file__).resolve().parents[2]
    env = dict(child_env(), HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home),
               PYTHONPATH=str(repo), OPENAI_API_KEY='loopback-only', OPENAI_BASE_URL=url,
               PYTHONUNBUFFERED='1')
    try:
        yield home, peer, lambda: daemon(repo, home, env, barrier=False)
    finally:
        peer.release.set()
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=5)


def receipt(home, sid):
    with SessionDB(home / 'state.db') as db:
        return json.loads(db.get_meta(POLICY_PREFIX + sid))


async def submit(ws, home, sid, text):
    result = await rpc(ws, 'prompt.submit', session_id=sid, input_id=text, text=text)
    assert 'result' in result, result
    await settled(home)


async def compress(ws, home, sid, request_id):
    with SessionDB(home / 'state.db') as db:
        row = db.get_session(sid)
    result = await rpc(ws, 'session.mutate', session_id=sid, request_id=request_id,
                       expected_revision=row['runtime_revision'], expected_generation=row['runtime_generation'],
                       operation='compress', payload={})
    assert result.get('result', {}).get('status') != 'noop', result
    assert 'result' in result, result
    tip = receipt(home, sid)['entry']['session_id']
    assert tip != sid, result
    return tip


@pytest.mark.platforms('linux', 'macos')
@pytest.mark.parametrize('divergent', [False, True], ids=['advance', 'replace-divergent-tip'])
def test_remote_compression_reconciles_local_receipt_and_restart(tmp_path, divergent):
    with device(tmp_path / 'a') as (a, peer_a, boot_a), device(tmp_path / 'b') as (b, _peer_b, boot_b):
        cloud = Cloud()
        with boot_a() as (_, desc_a), boot_b() as (_, desc_b):
            async def exchange():
                async with websocket(a, desc_a) as wa, websocket(b, desc_b) as wb:
                    created = await rpc(wa, 'session.create', request_id='cloud-chain', source='gui', toolsets=[])
                    sid = created['result']['session_id']
                    with SessionDB(a / 'state.db') as db:
                        db.set_session_title(sid, 'Titled compressed conversation')
                    for i in range(4):
                        await submit(wa, a, sid, f'A_ORIGINAL_{i}')
                    assert not sync(a, cloud)["status"]["issues"]
                    assert not sync(b, cloud)["status"]["issues"]
                    resumed = await rpc(wb, 'session.resume', session_id=sid)
                    with SessionDB(b / 'state.db') as db:
                        assert 'result' in resumed, (resumed, db.get_session(sid))
                    await submit(wb, b, sid, 'B_CONTINUED')
                    original = receipt(a, sid)
                    old_tip = None
                    if divergent:
                        await submit(wa, a, sid, 'A_OFFLINE_EDIT')
                        old_tip = await compress(wa, a, sid, 'compress-a')
                    tip = await compress(wb, b, sid, 'compress-b')
                    await submit(wb, b, sid, 'B_AFTER_COMPRESSION')
                    sync(b, cloud)
                    result = sync(a, cloud)
                    assert not result['status']['issues'], result
                    assert receipt(a, sid)['entry']['session_id'] == tip
                    resumed = await rpc(wa, 'session.resume', session_id=sid)
                    assert 'result' in resumed, resumed
                    await submit(wa, a, sid, 'A_WARM_AFTER_IMPORT')
                    current = receipt(a, sid)
                    assert current['entry']['session_id'] == tip
                    assert current['policy'] == original['policy']
                    assert current['principal_id'] == original['principal_id']
                    with SessionDB(a / 'state.db') as db:
                        row = db.get_session(tip)
                        assert (row['session_key'], row['chat_id'], row['user_id']) == (
                            original['route'], sid, original['principal_id'])
                        if old_tip:
                            assert db.get_session(old_tip) is None
                            copies = db._conn.execute("SELECT id FROM sessions WHERE title LIKE '%sync conflict%'").fetchall()
                            assert any('A_OFFLINE_EDIT' in json.dumps(db.get_messages(r[0])) for r in copies)
                    return sid, tip
            sid, tip = asyncio.run(exchange())
        with boot_a() as (_, desc_a):
            async def restart():
                async with websocket(a, desc_a) as ws:
                    resumed = await rpc(ws, 'session.resume', session_id=sid)
                    assert 'result' in resumed, resumed
                    await submit(ws, a, sid, 'A_RESTART_AFTER_IMPORT')
                    assert receipt(a, sid)['entry']['session_id'] == tip
                    inference = next(r for r in reversed(peer_a.requests) if any(
                        m.get('content') == 'A_RESTART_AFTER_IMPORT' for m in r['messages']))
                    assert any(m.get('content') == 'B_AFTER_COMPRESSION' for m in inference['messages'])
                    # A further inbound revision must also pass delete_targets' strict receipt validation.
                    sync(a, cloud)
            asyncio.run(restart())
