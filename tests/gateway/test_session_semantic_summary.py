"""Canonical summaries keep session model, ownership and cached prompts intact."""
import asyncio
import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio


class Peer:
    auth_identity = {'provider': 'local', 'user_id': 'owner'}

    def __init__(self):
        self.frames = asyncio.Queue()

    async def write_async(self, frame):
        await self.frames.put(frame)


@pytest_asyncio.fixture(params=['custom', 'aino'])
async def summary_owner(tmp_path, monkeypatch, request):
    from gateway.run import GatewayRunner
    from gateway.session_ancillary import physical_target
    from gateway.session_authority import initialize_session_authority
    from gateway.session_contract import SessionRef
    from gateway.session_controls import AuthorityConnection

    requests, hooks = [], []
    citation = []

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if self.path != '/v1/chat/completions':
                self.send_response(404)
                self.end_headers()
                return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append((body, dict(self.headers)))
            for hook in hooks:
                hook()
            summary = {'objective': {'text': 'Retain the current session route.', 'message_ids': citation},
                       'completed': [], 'conclusions': [], 'open_questions': []}
            payload = json.dumps({'id': 'summary-fixture', 'object': 'chat.completion', 'created': 1,
                'model': body['model'], 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': json.dumps(summary)}}],
                'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    home = tmp_path / 'profile'
    home.mkdir()
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'profile-must-not-run', 'base_url': origin + '/v1'},
        'auxiliary': {'session_summary': {'provider': 'auto', 'timeout': 5}}}))
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    authority = await initialize_session_authority(GatewayRunner(), profile_id=str(home), instance_id='summary')
    peer = Peer()
    connection = AuthorityConnection(authority, peer, {'provider': 'local', 'user_id': 'owner'}, operator=True)
    selection = ({'model_source': 'aino', 'model_id': 'catalog-summary'} if request.param == 'aino' else {
        'model': 'temporary-session-model', 'provider': 'custom', 'base_url': origin + '/v1',
        'api_key': 'session-key'})
    created = await connection.dispatch({'id': 'create', 'method': 'session.create', 'params': {
        'request_id': 'summary-create', 'source': 'gui', 'cwd': str(tmp_path), 'toolsets': [],
        **selection}})
    assert 'result' in created, created
    sid = created['result']['session_id']
    if request.param == 'aino':
        owner = {'platform_origin': origin, 'user_id': 'account-1'}
        ticket = await connection.dispatch({'id': 'ticket', 'method': 'session.managed_model_ticket',
            'params': {'session_id': sid, 'owner': owner, 'model_id': 'catalog-summary'}})
        claimed = await connection.dispatch({'id': 'claim', 'method': 'session.claim_managed_model',
            'params': {'session_id': sid, 'owner': owner, 'model_id': 'catalog-summary',
                       'session_ticket': ticket['result']['session_ticket']}})
        bound = await connection.dispatch({'id': 'bind', 'method': 'session.bind_managed_model', 'params': {
            'session_id': sid, 'owner': owner, 'model_id': 'catalog-summary',
            'binding_revision': claimed['result']['binding_revision'], 'credential_id': 'device-summary',
            'credential_type': 'device', 'credential_version': 1, 'expires_at': None,
            'model': 'managed-session-model', 'api_mode': 'chat_completions', 'api_key': 'session-key',
            'base_url': origin + '/v1', 'capabilities': {'tools': True, 'vision': False, 'reasoning': False},
            'context_window': 32000}})
        assert 'result' in bound, bound
    target = physical_target(authority, SessionRef(str(home), sid))
    citation.append(authority.db.append_message(target, 'user', 'Preserve the cited session summary. ' * 45))
    authority.db.append_message(target, 'assistant', 'The session model and history remain intact. ' * 45)
    try:
        yield SimpleNamespace(authority=authority, connection=connection, peer=peer, sid=sid, target=target,
                              origin=origin, requests=requests, hooks=hooks, home=home, source=request.param)
    finally:
        for hook in hooks:
            release = getattr(hook, 'release', None)
            if release:
                release()
        await connection.close()
        server.shutdown()
        server.server_close()
        worker.join(5)
        authority.db.close()


async def summary_call(rig, *, language='en', **params):
    reply = await rig.connection.dispatch({'id': 'summary', 'method': 'session.summary', 'params': {
        'session_id': rig.sid, 'language': language, **params}})
    return reply if reply is not None else await asyncio.wait_for(rig.peer.frames.get(), 15)


@pytest.mark.asyncio
async def test_canonical_summary_uses_own_route_and_preserves_history(summary_owner):
    rig = summary_owner
    before = rig.authority.db.get_messages(rig.target, include_inactive=True)
    reply = await summary_call(rig)
    assert reply.get('result', {}).get('summary'), reply
    body, headers = rig.requests[0]
    assert body['model'] == ('managed-session-model' if rig.source == 'aino' else 'temporary-session-model')
    assert headers['Authorization'] == 'Bearer session-key'
    if rig.source == 'aino':
        assert headers['X-Aino-Task'] == 'session_summary'
        assert headers['X-Aino-Model-ID'] == 'catalog-summary'
    assert rig.authority.db.get_messages(rig.target, include_inactive=True) == before
    assert (await summary_call(rig))['result']['stale'] is False
    assert len(rig.requests) == 1


@pytest.mark.asyncio
async def test_canonical_summary_refuses_foreign_owner_reader_and_profile(summary_owner):
    from gateway.session_controls import AuthorityConnection
    rig = summary_owner
    for identity, params in [
        ({'provider': 'local', 'user_id': 'stranger'}, {}),
        ({'provider': 'local', 'user_id': 'owner', 'capabilities': ['session:read']}, {}),
        ({'provider': 'local', 'user_id': 'owner'}, {'profile': 'foreign'}),
    ]:
        other = AuthorityConnection(rig.authority, Peer(), identity)
        try:
            reply = await other.dispatch({'id': 'denied', 'method': 'session.summary', 'params': {
                'session_id': rig.sid, 'language': 'en', **params}})
            assert reply.get('error', {}).get('data', {}).get('reason') in {
                'permission_denied', 'profile_mismatch'}, reply
        finally:
            await other.close()
    assert not rig.requests


@pytest.mark.asyncio
async def test_foreground_turn_supersedes_summary_without_writing_stale_cache(summary_owner, monkeypatch):
    rig = summary_owner
    original = rig.authority._handle

    def start_foreground():
        monkeypatch.setattr(rig.authority, '_handle', lambda ref: replace(
            original(ref), execution_generation=original(ref).execution_generation + 1, execution_state='running'))

    rig.hooks.append(start_foreground)
    result = (await summary_call(rig))['result']
    assert result['busy'] is True and result['error_code'] == 'busy'
    assert result['summary'] is None
    monkeypatch.setattr(rig.authority, '_handle', original)
    rig.hooks.clear()
    assert (await summary_call(rig))['result']['summary']
    assert len(rig.requests) == 2


@pytest.mark.asyncio
async def test_summary_reuses_resident_agent_without_touching_prompt_or_tools(summary_owner, monkeypatch):
    from gateway.session_authorities import owner_scope
    from gateway.session_contract import SessionRef
    from gateway.session_llm_oneshot import _session_runtime
    rig = summary_owner
    ref = SessionRef(str(rig.home), rig.sid)
    with owner_scope(rig.authority):
        runtime = _session_runtime(rig.authority, ref)()
    agent = SimpleNamespace(**runtime, _cached_system_prompt='A cached conversation prefix.', tools=['terminal'])
    monkeypatch.setattr(rig.authority, 'agent', lambda _: agent)
    before = dict(vars(agent))
    assert (await summary_call(rig))['result']['summary']
    assert vars(agent) == before
