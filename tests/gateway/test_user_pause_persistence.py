"""Canonical early pauses preserve the original task until Continue owns the existing lease."""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import pytest

from agent.managed_worker import accept_result, result_frame
from gateway.session_controls import AuthorityConnection
from gateway.session_pause import continuation_descriptor, continuation_history, continuation_turn_scope, prepare_continuation
from gateway.session_results import finish_result
from hermes_state_runtime import claim_session_input
from tests.agent.test_preflight_compression_cap_e2e import _config
from tests.gateway.test_surface_admission import _authority


@pytest.fixture
def model():
    requests = []

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.path != '/v1/chat/completions':
                self.send_error(404)
                return
            requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'id': 'fixture', 'object': 'chat.completion', 'created': 1,
                'model': 'test/model', 'choices': [{'index': 0, 'finish_reason': 'stop',
                    'message': {'role': 'assistant', 'content': 'Completed original task.'}}],
                'usage': {'prompt_tokens': 10, 'completion_tokens': 3, 'total_tokens': 13}}).encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/v1', requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def _submit(connection, request_id, text, **extra):
    reply = await connection.dispatch({'id': request_id, 'method': 'prompt.submit', 'params': {
        'session_id': 's', 'submission_id': str(request_id), 'text': text, **extra}})
    assert reply['result']['status'] == 'queued', reply
    return reply


@pytest.mark.asyncio
@pytest.mark.parametrize('early', ['lease', 'bootstrap', 'file'])
async def test_early_user_pause_restores_original_once_after_continue_takes_lease(tmp_path, monkeypatch, model, early):
    from agent.interrupt_compat import request_hard_interrupt
    from gateway.session_managed_worker import _interrupted_before_bootstrap
    from run_agent import AIAgent

    authority = await _authority(tmp_path, monkeypatch, lambda event: None)
    monkeypatch.setattr(authority, '_schedule', lambda ref: None)
    connection = AuthorityConnection(authority, object(), {'user_id': 'owner'})
    origin, requests = model
    config = {**_config(3), 'auxiliary': {'title_generation': {'enabled': False}}}
    monkeypatch.setattr('hermes_cli.config.load_config', lambda: config)
    monkeypatch.setattr('hermes_cli.config.load_config_readonly', lambda: config)
    with patch('model_tools.get_tool_definitions', return_value=[]), \
            patch('model_tools.check_toolset_requirements', return_value={}):
        agent = AIAgent(base_url=origin, api_key='fixture', provider='custom', api_mode='chat_completions',
            model='test/model', max_iterations=3, enabled_toolsets=[], disabled_toolsets=[], quiet_mode=True,
            skip_memory=True, skip_context_files=True, skip_background_review=True,
            session_db=authority.db, session_id='s')
    agent.compression_enabled = False
    agent._cached_system_prompt = 'You are helpful.'
    agent._use_prompt_caching, agent._disable_streaming = False, True
    original = 'ORIGINAL_UNEXECUTED_TASK'
    if early == 'file':
        document = tmp_path / 'original.txt'
        document.write_text('ORIGINAL_FILE_CONTEXT_MUST_REACH_PROVIDER')
        original += f' @file:{document}'
    try:
        await connection.dispatch({'id': 1, 'method': 'session.resume', 'params': {'session_id': 's'}})
        await _submit(connection, 2, original)
        row = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        assert authority.db.get_messages('s') == []
        if early == 'lease':
            request_hard_interrupt(agent)
            paused = await asyncio.to_thread(agent.run_conversation, row['payload']['text'])
            accepted, _ = accept_result(result_frame(paused))
            captured = {'result': accepted, 'usage': {}}
        else:
            _interrupted_before_bootstrap(authority, row)
            captured = authority.pending_results[row['admission_id']]
        assert not requests and authority.db.get_messages('s') == []
        for _ in range(2):
            finish_result(authority.db, epoch=authority.epoch, row=row, response='', outcome='interrupted', result=captured)
        assert authority.db.get_messages('s') == []  # settlement never writes beside a foreign lease
        session = authority.db.get_session('s')
        await _submit(connection, 3, 'Continue from preserved progress.', display_kind='hidden', continuation_of={
            'admission_id': row['admission_id'], 'execution_generation': row['generation'],
            'revision': session['runtime_revision']})
        continued = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        descriptor = continuation_descriptor(authority.db, continued)
        assert descriptor['admission_id'] == row['admission_id']
        if early == 'file':
            from gateway.session_local import _bypass_policy
            from gateway.session_contract import SessionRef
            policy = _bypass_policy({'cwd': str(tmp_path), 'model': 'test/model', 'provider': 'custom',
                'base_url': origin, 'ignore_user_config': True}, private_secrets={})
            descriptor, refusal = await prepare_continuation(authority, SessionRef(authority.profile_id, 's'), continued, policy)
            assert refusal is None
        with continuation_turn_scope(descriptor):
            history = continuation_history(authority.db.get_messages_as_conversation('s'))
        assert authority.db.get_messages('s') == []
        waiting = threading.Event()
        agent._emit_status = lambda text: waiting.set() if 'Another Hermes process' in text else None
        assert authority.db.acquire_session_turn_lease('s', 'foreign-holder', wait_seconds=0)
        task = asyncio.create_task(asyncio.to_thread(agent.run_conversation, continued['payload']['text'],
            conversation_history=history, persist_user_display_kind='hidden'))
        try:
            assert await asyncio.to_thread(waiting.wait, 10), 'Continue did not wait for the foreign lease'
            assert not requests and authority.db.get_messages('s') == []
        finally:
            authority.db.release_session_turn_lease('s', 'foreign-holder')
        result = await asyncio.wait_for(task, 20)
        assert result['completed'], result
        assert len(requests) == 1
        wire = requests[0]['messages']
        assert sum(str(m.get('content', '')).startswith('ORIGINAL_UNEXECUTED_TASK') for m in wire) == 1
        if early == 'file':
            assert 'ORIGINAL_FILE_CONTEXT_MUST_REACH_PROVIDER' in json.dumps(wire)
        stored = authority.db.get_messages('s')
        assert sum(m['role'] == 'user' and str(m['content']).startswith('ORIGINAL_UNEXECUTED_TASK') for m in stored) == 1
        assert [m['role'] for m in stored] == ['user', 'assistant', 'user', 'assistant']
        assert stored[1]['display_kind'] == 'hidden'
        # Reusing the staged prefix after a later cache reload must not materialize it twice.
        with continuation_turn_scope(descriptor):
            assert continuation_history(authority.db.get_messages_as_conversation('s')) == authority.db.get_messages_as_conversation('s')
    finally:
        request_hard_interrupt(agent)
        agent.client.close()
        await connection.close()
