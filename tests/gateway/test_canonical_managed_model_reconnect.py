"""A running Desktop admission outlives its viewer, without authorizing another turn.

The real canonical FIFO and model-credential resolver run against a temporary profile. Only
the model's waiting/tool loop is held at a seam so disconnects land between its HTTP calls.
"""

import asyncio
from contextlib import asynccontextmanager
from contextvars import copy_context
from pathlib import Path
from types import SimpleNamespace

import pytest

from tests.gateway.test_canonical_managed_model_binding import Peer, call
from tests.waiting import async_wait_until


async def _bind(viewer, controller, sid, *, key='first-key', version=1, origin='http://127.0.0.1:17321'):
    selected = dict(session_id=sid, owner={
        'platform_origin': origin, 'user_id': 'account-1'}, model_id='catalog-a')
    ticket = await call(viewer, 'session.managed_model_ticket', **selected)
    assert 'result' in ticket, ticket
    claimed = await call(controller, 'session.claim_managed_model', **selected,
                         session_ticket=ticket['result']['session_ticket'])
    assert 'result' in claimed, claimed
    revision = claimed['result']['binding_revision']
    bound = await call(controller, 'session.bind_managed_model', **selected,
                       binding_revision=revision, credential_id='device-key', api_key=key,
                       credential_type='device', credential_version=version, expires_at=None,
                       base_url=selected['owner']['platform_origin'] + '/v1', model='upstream-model',
                       api_mode='chat_completions',
                       capabilities={'tools': True, 'vision': False, 'reasoning': False})
    assert bound.get('result', {}).get('bound') is True, bound
    return revision


@asynccontextmanager
async def _running_desktop(tmp_path, monkeypatch):
    from gateway import session_finite
    from gateway.run import GatewayRunner
    from gateway.run_turn_prepare import _resolve_policy_agent_runtime
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    from gateway.session_platform_model import binding_key
    from gateway.session_policy import policy_for_source
    from tui_gateway.managed_model_runtime import get_registry

    home = tmp_path / 'profile'
    home.mkdir()
    (home / 'config.yaml').write_text('model:\n  provider: custom\n  default: unrelated\n', encoding='utf-8')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id='reconnect')
    peers = []

    def connection():
        peer = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
        peers.append(peer)
        return peer

    from hermes_state_runtime import RuntimeStoreError

    started = asyncio.Event()
    commands = asyncio.Queue()
    agent = SimpleNamespace(interrupted=False)

    def interrupt():
        agent.interrupted = True

    agent.hard_interrupt = interrupt
    monkeypatch.setattr(authority, 'agent', lambda _ref: agent)

    async def execute(current, ref, row):
        live = current.sessions[ref.session_id]
        _, runtime = _resolve_policy_agent_runtime(
            runner, policy_for_source(runner, live.source), source=live.source)
        agent.api_key = runtime['api_key']
        agent.execution_context = copy_context()
        started.set()
        while True:
            request = await commands.get()
            if request is None:
                return 'completed answer'
            try:
                request.set_result(agent.api_key())
            except RuntimeStoreError as exc:
                request.set_exception(exc)

    async def probe():
        request = asyncio.get_running_loop().create_future()
        commands.put_nowait(request)
        return await asyncio.wait_for(request, 10)

    def finish():
        commands.put_nowait(None)

    monkeypatch.setattr(session_finite, 'execute_finite_admission', execute)
    viewer, controller = connection(), connection()
    sid = None
    try:
        created = await call(viewer, 'session.create', request_id='reconnect-create', source='gui',
                             cwd=str(tmp_path), toolsets=[], model_source='aino', model_id='catalog-a')
        assert 'result' in created, created
        sid = created['result']['session_id']
        revision = await _bind(viewer, controller, sid)
        submitted = await call(viewer, 'prompt.submit', session_id=sid,
                               submission_id='running-first', text='read a file, then answer')
        assert 'result' in submitted, submitted
        await asyncio.wait_for(started.wait(), 10)
        yield SimpleNamespace(authority=authority, viewer=viewer, controller=controller, sid=sid,
                              revision=revision, agent=agent, finish=finish, probe=probe,
                              connection=connection, registry=get_registry(),
                              key=binding_key(authority, sid))
    finally:
        finish()
        if sid is not None:
            await async_wait_until(
                lambda: all(live.task is None or live.task.done() for live in authority.sessions.values()),
                timeout=10, what='the held model turn and its settlement finished')
        for peer in peers:
            await peer.close()
        if sid is not None:
            get_registry().clear_session(binding_key(authority, sid))
        authority.db.close()


@pytest.mark.asyncio
async def test_viewer_reconnect_preserves_only_its_claimed_turn(tmp_path, monkeypatch):
    from hermes_state_runtime import RuntimeStoreError

    async with _running_desktop(tmp_path, monkeypatch) as rig:
        credential = rig.agent.api_key
        old_context = rig.agent.execution_context
        assert await rig.probe() == 'first-key'
        await rig.viewer.close()
        assert not rig.agent.interrupted, 'closing a viewer must not stop an admitted model/tool loop'
        assert rig.registry.get(rig.key) is None, 'a detached binding must not authorize another turn'
        assert await rig.probe() == 'first-key', 'the next model call belongs to the same admitted turn'

        replacement, new_controller = rig.connection(), rig.connection()
        resumed = await call(replacement, 'session.resume', session_id=rig.sid)
        assert 'result' in resumed, resumed
        denied = await call(replacement, 'prompt.submit', session_id=rig.sid,
                            submission_id='detached-next', text='not yet authorized')
        assert denied['error']['data']['reason'] == 'awaiting_managed_credentials', denied
        await _bind(replacement, new_controller, rig.sid, key='replacement-key', version=2)
        assert not rig.agent.interrupted
        assert await rig.probe() == 'replacement-key', 'same-account renewal must reach subsequent model calls'
        await rig.controller.close()
        assert rig.registry.get(rig.key).api_key == 'replacement-key', 'a stale socket cannot revoke its successor'
        assert await rig.probe() == 'replacement-key'

        rig.finish()
        await async_wait_until(lambda: rig.authority.sessions[rig.sid].task.done(),
                               timeout=10, what='the first turn completed and settled')
        submitted = await call(replacement, 'prompt.submit', session_id=rig.sid,
                               submission_id='running-second', text='another authorized turn')
        assert 'result' in submitted, submitted
        await async_wait_until(lambda: rig.agent.execution_context is not old_context,
                               timeout=10, what='the next generation reached its model loop')
        await replacement.close()
        assert not rig.agent.interrupted
        assert await rig.probe() == 'replacement-key'
        with pytest.raises(RuntimeStoreError, match='awaiting_managed_credentials'):
            old_context.run(credential)
        rig.finish()
        await async_wait_until(lambda: rig.authority.sessions[rig.sid].task.done(),
                               timeout=10, what='the detached second turn completed and settled')
        with pytest.raises(RuntimeStoreError, match='awaiting_managed_credentials'):
            old_context.run(credential)
        cold = rig.connection()
        resumed = await call(cold, 'session.resume', session_id=rig.sid)
        assert 'result' in resumed, resumed
        denied = await call(cold, 'prompt.submit', session_id=rig.sid,
                            submission_id='after-settlement', text='requires a fresh binding')
        assert denied['error']['data']['reason'] == 'awaiting_managed_credentials', denied


@pytest.mark.asyncio
async def test_explicit_revoke_still_stops_an_admitted_turn(tmp_path, monkeypatch):
    from hermes_state_runtime import RuntimeStoreError

    async with _running_desktop(tmp_path, monkeypatch) as rig:
        assert await rig.probe() == 'first-key'
        cleared = await call(rig.controller, 'session.clear_managed_model', session_id=rig.sid,
                             binding_revision=rig.revision)
        assert cleared.get('result') == {'cleared': True}, cleared
        assert rig.agent.interrupted, 'an explicit revocation must reach the running agent'
        with pytest.raises(RuntimeStoreError, match='awaiting_managed_credentials'):
            await rig.probe()
