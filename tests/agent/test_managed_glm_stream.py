"""A quiet interval on the desktop's managed GLM stream is not a second request."""

import json
import threading

import httpx
import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, managed_operation_scope
from agent.chat_completion_helpers import _StreamingCall
from agent.managed_inference_errors import ManagedOperationUnknown
from run_agent import AIAgent


@pytest.mark.parametrize('platform', ['desktop', 'subagent'])
@pytest.mark.parametrize('silence,completes', [(210, True), (900, False)])
def test_quiet_managed_glm_stream(silence, completes, platform, monkeypatch, tmp_path):
    model, url = 'glm-5.3-flash', 'https://aino.invalid/v1'
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.delenv('HERMES_STREAM_STALE_TIMEOUT', raising=False)
    key = ManagedCredential(lambda: 'fixture', 'owner', 'session', model, url, 'chat_completions', False,
                            scope=BillingScope('aino', 'owner', 'session', 'turn', 'chat'))
    requests, notices = [], []
    quiet, checked = threading.Event(), threading.Event()

    def chunk(text, finish=None):
        data = {'id': 'fixture', 'object': 'chat.completion.chunk', 'model': model, 'created': 1,
                'choices': [{'index': 0, 'delta': {'content': text}, 'finish_reason': finish}]}
        return ('data: ' + json.dumps(data) + '\n\n').encode()

    class DelayedReply(httpx.SyncByteStream):
        def __iter__(self):
            yield chunk('first ')
            # The SDK has consumed a real chunk. Advance just its idle age, then
            # withhold the rest until the production watchdog has checked that gap.
            call.last_chunk_time['t'] -= silence
            quiet.set()
            assert checked.wait(5), 'watchdog never checked the quiet stream'
            yield chunk('last', 'stop')
            yield b'data: [DONE]\n\n'

    def dispatch(client, request):
        assert request.url.host == 'aino.invalid'
        if request.url.path != '/v1/chat/completions':
            return httpx.Response(404, request=request)
        requests.append(request)
        return httpx.Response(200, headers={'content-type': 'text/event-stream'}, request=request, stream=DelayedReply())

    monkeypatch.setattr(httpx.Client, '_send_single_request', dispatch)
    agent = AIAgent(api_key=key, base_url=url, provider='aino', model=model, platform=platform, quiet_mode=True,
                    skip_context_files=True, skip_memory=True, enabled_toolsets=[], stream_delta_callback=lambda _: None)
    agent._emit_diagnostic_wait = notices.append
    agent._buffer_diagnostic_status = notices.append
    call = _StreamingCall(agent, {'model': model, 'messages': [{'role': 'user', 'content': 'fixture'}]}, None)
    monitor = call._monitor_loop
    check_lifetime = call._check_stream_lifetime

    def monitor_after_chunk():
        assert quiet.wait(5), 'the first chunk never arrived'
        monitor()

    def finish_tick():
        check_lifetime()
        checked.set()

    monkeypatch.setattr(call, '_monitor_loop', monitor_after_chunk)
    monkeypatch.setattr(call, '_check_stream_lifetime', finish_tick)
    with managed_operation_scope('test:chat'):
        if completes:
            choice = call.run().choices[0]
            assert (choice.message.content, choice.finish_reason) == ('first last', 'stop')
        else:
            with pytest.raises(ManagedOperationUnknown):
                call.run()
    assert len(requests) == 1 and requests[0].headers['x-aino-operation-id']
    assert requests[0].extensions['timeout']['read'] >= 210
    assert not any('reconnect' in message.lower() for message in notices)
