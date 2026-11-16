"""A real Agent/SDK tool roundtrip finishes after its Desktop viewer disconnects."""

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from types import SimpleNamespace

import pytest

from tests.gateway.test_canonical_managed_model_binding import Peer, call
from tests.gateway.test_canonical_managed_model_reconnect import _bind
from tests.waiting import async_wait_until

FINAL = 'The local file was read and the complete answer was saved.'
FILE_CONTENT = 'CANONICAL_RECONNECT_FILE_CONTENT'


@pytest.fixture
def tool_model(tmp_path):
    """Only the post-tool inference blocks; model discovery and the first tool call remain real."""
    requests = []
    entered, release = threading.Event(), threading.Event()
    sample = tmp_path / 'sample.txt'
    sample.write_text(FILE_CONTENT, encoding='utf-8')

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self._reply(json.dumps({'data': [{'id': 'upstream-model', 'context_length': 256000}]}).encode(),
                        'application/json')

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.path != '/v1/chat/completions':
                self.send_error(404)
                return
            requests.append((self.headers.get('Authorization'), body))
            has_result = any(row.get('role') == 'tool' for row in body['messages'])
            if has_result:
                entered.set()
                if not release.wait(30):
                    self.send_error(503)
                    return
            message = {'role': 'assistant', 'content': FINAL} if has_result else {
                'role': 'assistant', 'content': None, 'tool_calls': [{
                    'id': 'read-sample', 'type': 'function', 'function': {
                        'name': 'read_file', 'arguments': json.dumps({'path': str(sample)})}}]}
            finish = 'stop' if has_result else 'tool_calls'
            frame = {'id': 'loopback', 'model': 'upstream-model',
                     'choices': [{'index': 0, 'message': message, 'finish_reason': finish}],
                     'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}}
            if body.get('stream'):
                delta = dict(message)
                if 'tool_calls' in delta:
                    delta['tool_calls'] = [{'index': 0, **row} for row in delta['tool_calls']]
                frame['choices'][0]['delta'] = delta
                del frame['choices'][0]['message']
                self._reply(('data: ' + json.dumps(frame) + '\n\ndata: [DONE]\n\n').encode(),
                            'text/event-stream')
            else:
                self._reply(json.dumps(frame).encode(), 'application/json')

        def _reply(self, payload, content_type):
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    http = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    try:
        yield SimpleNamespace(origin=f'http://127.0.0.1:{http.server_port}', requests=requests,
                              entered=entered, release=release, sample=sample)
    finally:
        release.set()
        http.shutdown()
        http.server_close()
        worker.join(timeout=5)


@pytest.mark.asyncio
async def test_tool_reply_persists_after_the_viewer_closes_during_inference(tmp_path, monkeypatch, tool_model):
    from gateway.run import GatewayRunner
    from gateway.session_ancillary import physical_target
    from gateway.session_authority import initialize_session_authority
    from gateway.session_contract import SessionRef
    from gateway.session_controls import AuthorityConnection
    from gateway.session_platform_model import binding_key
    from hermes_state_runtime import list_session_admissions
    from run_agent import AIAgent
    from tui_gateway.managed_model_runtime import get_registry

    home = tmp_path / 'profile'
    home.mkdir()
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'unused', 'base_url': tool_model.origin + '/v1'},
        'agent': {'max_turns': 4}, 'memory': {'enabled': False},
        'auxiliary': {'title_generation': {'enabled': False}},
        'gateway': {'multiplex_profiles': False}, 'terminal': {'cwd': str(tmp_path)},
    }), encoding='utf-8')
    (home / 'models_dev_cache.json').write_text('{}', encoding='utf-8')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id='real-tool-reconnect')
    identity = {'user_id': 'owner', 'provider': 'local'}
    viewer, controller = [AuthorityConnection(authority, Peer(), identity, operator=True) for _ in range(2)]
    sid = None
    agent = None
    try:
        created = await call(viewer, 'session.create', request_id='real-tool-create', source='gui',
                             cwd=str(tmp_path), toolsets=['file'], ignore_rules=True,
                             model_source='aino', model_id='catalog-a')
        assert 'result' in created, created
        sid = created['result']['session_id']
        await _bind(viewer, controller, sid, origin=tool_model.origin)
        submitted = await call(viewer, 'prompt.submit', session_id=sid, submission_id='read-then-finish',
                               text=f'Read {tool_model.sample} and give the final answer.')
        assert 'result' in submitted, submitted
        assert await asyncio.to_thread(tool_model.entered.wait, 30), 'the Agent never requested the post-tool reply'
        ref = SessionRef(authority.profile_id, sid)
        agent = authority.agent(ref)
        assert isinstance(agent, AIAgent), 'this regression must exercise the real Agent and SDK'
        await viewer.close()
        assert not agent._interrupt_requested
        tool_model.release.set()
        await async_wait_until(lambda: authority.sessions[sid].task.done(), timeout=30,
                               what='the disconnected tool turn to persist its final answer')
        [admission] = list_session_admissions(authority.db, session_id=sid, pending_only=False)
        assert (admission['status'], admission['outcome']) == ('terminal', 'completed'), admission
        history = authority.db.get_messages(physical_target(authority, ref))
        assert any(row['role'] == 'tool' and FILE_CONTENT in str(row['content']) for row in history), history
        assert any(row['role'] == 'assistant' and row['content'] == FINAL for row in history), history
        assert not any((row.get('display_metadata') or {}).get('interrupted') for row in history), history
        assert not agent._interrupt_requested
        assert len(tool_model.requests) == 2, 'disconnect must not replay paid inference'
        assert all(auth == 'Bearer first-key' for auth, _ in tool_model.requests)
        assert FILE_CONTENT in json.dumps(tool_model.requests[1][1]['messages'])
    finally:
        tool_model.release.set()
        if sid is not None:
            await async_wait_until(lambda: authority.sessions[sid].task is None or authority.sessions[sid].task.done(),
                                   timeout=35, what='the real model worker to finish before cleanup')
        await viewer.close()
        await controller.close()
        if sid is not None:
            get_registry().clear_session(binding_key(authority, sid))
        if agent is not None:
            await asyncio.to_thread(agent.release_clients)
        authority.db.close()
