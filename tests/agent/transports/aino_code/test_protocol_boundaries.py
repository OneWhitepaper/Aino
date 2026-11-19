"""Protocol boundaries: complete tools, revocable turns and route-scoped replay."""
import io
import json
import threading
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, billing_scope
from agent.runtime_scope import bind_profile_scope
from agent.transports.aino_code.binding import CodeModelBinding
from agent.transports.aino_code.relay import CodeModelRoute, ResponsesRelay, _RelayHandler
from agent.transports.aino_code.replay import ReplayCodec


def chunk(calls=None, finish=None, **delta):
    if calls is not None:
        delta['tool_calls'] = calls
    return {'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}


def call(index=0, name='shell', arguments='{}', call_id=None):
    return {'index': index, 'id': call_id or f'call-{index}',
            'type': 'function', 'function': {'name': name, 'arguments': arguments}}


def stream_events(frames, mode='chat_completions', tools=None):
    data = ''.join('data: ' + (f if isinstance(f, str) else json.dumps(f)) + '\n\n' for f in frames)
    response = httpx.Response(200, headers={'Content-Type': 'text/event-stream'}, content=data)
    relay = ResponsesRelay.__new__(ResponsesRelay)
    relay.route = CodeModelRoute('fixture-model', 'http://127.0.0.1:9/v1', 'fixture-key', api_mode=mode)
    relay.replay = ReplayCodec(Fernet.generate_key(), 'fixture-scope')
    prepared = SimpleNamespace(body={'model': 'fixture-model'}, tools=tools or {
        'shell': {'type': 'function', 'name': 'exec_command'},
        'patch': {'type': 'custom', 'name': 'apply_patch'},
    })
    return [json.loads(data.decode().split('data: ', 1)[1])
            for data in relay.converted_stream(response, prepared)]


def tool_done(events):
    return [event['item']['call_id'] for event in events
            if event['type'] == 'response.output_item.done'
            and event['item']['type'] in {'function_call', 'custom_tool_call'}]


def test_valid_parallel_tools_are_released_together():
    events = stream_events([chunk([call(0), call(1)], finish='tool_calls'), '[DONE]'])
    assert tool_done(events) == ['call-0', 'call-1']
    assert events[-1]['type'] == 'response.completed'


def test_late_invalid_unicode_does_not_release_earlier_tool():
    events = stream_events([chunk([
        call(0, arguments='{"cmd":"fixture only"}'),
        call(1, name='patch', arguments=json.dumps({'input': '\ud800'})),
    ], finish='tool_calls'), '[DONE]'])
    assert events[-1]['type'] == 'response.failed'
    assert not tool_done(events), f'tool released before failure: {tool_done(events)}'


@pytest.mark.parametrize('arguments', ['{"nested":{"value":"\\ud800"}}', '{"nested":[NaN]}'])
def test_invalid_nested_function_arguments_do_not_release_any_tool(arguments):
    events = stream_events([chunk([
        call(0, arguments='{"cmd":"fixture only"}'), call(1, arguments=arguments),
    ], finish='tool_calls'), '[DONE]'])
    assert events[-1]['type'] == 'response.failed'
    assert not tool_done(events)


def test_chat_eof_without_done_does_not_release_tool():
    events = stream_events([chunk([call()], finish='tool_calls')])
    assert not tool_done(events), f'EOF was accepted as completed: {events[-1]["type"]}'


@pytest.mark.parametrize('mode,finish', [('chat_completions', 'end_turn'), ('anthropic_messages', 'stop')])
def test_other_protocol_finish_cannot_authorize_tool(mode, finish):
    if mode == 'chat_completions':
        frames = [chunk([call()], finish=finish), '[DONE]']
    else:
        frames = [
            {'type': 'message_start', 'message': {'usage': {}}},
            {'type': 'content_block_start', 'index': 0, 'content_block': {
                'type': 'tool_use', 'id': 'call-0', 'name': 'shell', 'input': {}}},
            {'type': 'content_block_stop', 'index': 0},
            {'type': 'message_delta', 'delta': {'stop_reason': finish}},
            {'type': 'message_stop'},
        ]
    events = stream_events(frames, mode=mode)
    assert not tool_done(events), f'foreign finish reason {finish!r} released tool'


def agent(home, *, tenant='a', secret='fixture-a', session='same-session', model='fixture-model'):
    return SimpleNamespace(execution_mode='code', api_mode='anthropic_messages',
        model=model, provider=f'custom:{tenant}', base_url='http://127.0.0.1:9/v1',
        api_key=secret, session_id=session, session_cwd=str(home / 'workspace'),
        _client_kwargs={'default_headers': {'X-Tenant': tenant}})


def test_replay_survives_restart_and_rejects_other_model_and_session(tmp_path):
    with bind_profile_scope(tmp_path, hydrate_secrets=False):
        first = CodeModelBinding(agent(tmp_path))
        try:
            token = first.relay.replay.seal({'chat': {'reasoning_content': 'fixture'}})
        finally:
            first.close()
        for session, model, expected in [('same-session', 'fixture-model', True),
                                         ('different-session', 'fixture-model', False),
                                         ('same-session', 'other-model', False)]:
            other = CodeModelBinding(agent(tmp_path, session=session, model=model))
            try:
                assert bool(other.relay.replay.open(token)) is expected
            finally:
                other.close()


def test_changed_tenant_route_cannot_open_prior_route_replay(tmp_path):
    with bind_profile_scope(tmp_path, hydrate_secrets=False):
        first = CodeModelBinding(agent(tmp_path))
        try:
            token = first.relay.replay.seal({'anthropic': {'content': [
                {'type': 'thinking', 'thinking': 'tenant-a-private-state', 'signature': 'tenant-a-signature'}]}})
            old_route = first.route
        finally:
            first.close()
        second = CodeModelBinding(agent(tmp_path, tenant='b', secret='fixture-b'))
        try:
            assert second.route != old_route
            assert second.relay.replay.open(token) == {}, 'tenant B accepts tenant A encrypted history'
        finally:
            second.close()


def test_distinct_profiles_cannot_open_each_others_replay(tmp_path):
    token = None
    for name in ('alpha', 'beta'):
        home = tmp_path / name
        with bind_profile_scope(home, hydrate_secrets=False):
            binding = CodeModelBinding(agent(home))
            try:
                if token is None:
                    token = binding.relay.replay.seal({'chat': {'reasoning_content': 'alpha fixture'}})
                else:
                    with pytest.raises(ValueError, match='could not be verified'):
                        binding.relay.replay.open(token)
            finally:
                binding.close()


def test_managed_identity_refresh_and_wrong_scope_fail_closed():
    live = ['fixture-key-1', 'fixture-catalog-1', 1]
    credential = ManagedCredential(lambda: live[0], 'user-a', 'session-a', 'fixture-model',
        'http://127.0.0.1:9/v1', 'anthropic_messages', False,
        get_request_identity=lambda: tuple(live))
    relay = ResponsesRelay.__new__(ResponsesRelay)
    relay.route = CodeModelRoute('fixture-model', credential.base_url, credential, api_mode='anthropic_messages')
    relay.client = httpx.Client(transport=httpx.MockTransport(lambda request: pytest.fail('No request should dispatch')),
                                trust_env=False)
    handler = SimpleNamespace(headers={'Authorization': 'Bearer fixture-relay-token',
        'X-Aino-Turn-Id': 'spoofed', 'X-Aino-Model-ID': 'spoofed', 'x-api-key': 'spoofed'})
    try:
        for i in (1, 2):
            live[:] = [f'fixture-key-{i}', f'fixture-catalog-{i}', i]
            scope = billing_scope.set(BillingScope('aino', 'user-a', 'session-a', f'turn-{i}', 'chat'))
            try:
                request = relay.request(handler, '/messages', b'{"model":"fixture-model"}')
                assert request.headers['Authorization'] == f'Bearer fixture-key-{i}'
                assert request.headers['X-Aino-Turn-Id'] == f'turn-{i}'
                assert request.headers['X-Aino-Model-ID'] == f'fixture-catalog-{i}'
                assert 'x-api-key' not in request.headers
                assert request.url == credential.base_url + '/messages'
            finally:
                billing_scope.reset(scope)
        scope = billing_scope.set(BillingScope('aino', 'wrong-user', 'session-a', 'turn-3', 'chat'))
        try:
            with pytest.raises(RuntimeError, match='managed_billing_scope_mismatch'):
                relay.request(handler, '/messages', b'{"model":"fixture-model"}')
        finally:
            billing_scope.reset(scope)
    finally:
        relay.client.close()


def test_newly_sealed_replay_can_always_be_reopened():
    from agent.transports.aino_code.protocol_stream import response_events
    codec = ReplayCodec(Fernet.generate_key(), 'fixture-scope')
    reasoning = 'x' * (12 * 1024 * 1024)
    response = httpx.Response(200, json={'object': 'chat.completion', 'choices': [{
        'index': 0, 'message': {'role': 'assistant', 'reasoning_content': reasoning, 'content': 'done'},
        'finish_reason': 'stop'}]})
    prepared = SimpleNamespace(body={'model': 'fixture-model'}, tools={})
    events = list(response_events(response, prepared, 'chat_completions', codec))
    assert events[-1]['type'] == 'response.completed'
    token = next(item['encrypted_content'] for item in events[-1]['response']['output']
                 if item['type'] == 'reasoning')
    assert codec.open(token) == {'chat': {'reasoning_content': reasoning}}


def test_turn_end_revokes_request_still_reading_its_body():
    reached_body, release_body = threading.Event(), threading.Event()
    sent, failures, thread_errors = [], [], []
    credential = ManagedCredential(lambda: 'fixture-key', 'fixture-user', 'fixture-session',
                                   'fixture-model', 'http://127.0.0.1:9/v1', 'codex_responses', False)
    relay = ResponsesRelay.__new__(ResponsesRelay)
    relay.route = CodeModelRoute('fixture-model', credential.base_url, credential)
    relay.context, relay.lock, relay.token = None, threading.Lock(), 'fixture-local-token'
    def upstream(request):
        sent.append(dict(request.headers))
        return httpx.Response(200, stream=httpx.ByteStream(b'fixture'))
    relay.client = httpx.Client(transport=httpx.MockTransport(upstream), trust_env=False)
    def read_body():
        reached_body.set()
        assert release_body.wait(5)
        return b'{"model":"fixture-model","input":"fixture"}'
    handler = SimpleNamespace(server=SimpleNamespace(relay=relay), path='/v1/responses',
        headers={'Authorization': 'Bearer fixture-local-token'}, read_body=read_body,
        fail=lambda status, message, **kwargs: failures.append(status),
        send_response=lambda status: None, send_header=lambda *args: None,
        end_headers=lambda: None, wfile=io.BytesIO())
    def run_handler():
        try:
            _RelayHandler.do_POST(handler)
        except Exception as exc:
            thread_errors.append(exc)
    scope = billing_scope.set(BillingScope('aino', 'fixture-user', 'fixture-session', 'turn-already-ended', 'chat'))
    worker = threading.Thread(target=run_handler)
    try:
        with relay.turn_context():
            worker.start()
            assert reached_body.wait(5)
        assert relay.context is None
        release_body.set()
        worker.join(5)
        assert not worker.is_alive() and not thread_errors
        assert not sent, f'dispatched after teardown with turn ID: {sent[0].get("x-aino-turn-id")}'
    finally:
        release_body.set()
        worker.join(5)
        billing_scope.reset(scope)
        relay.client.close()
