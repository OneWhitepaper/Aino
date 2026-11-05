"""A managed summary's unknown outcome stops the owning turn on every main route."""

from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from agent.managed_inference_errors import ManagedOperationUnknown
from tests.agent.test_managed_operation_retry import credential
from tests.agent.test_preflight_compression_cap_e2e import _make_agent, _stop_response


@pytest.mark.parametrize('managed_main', [False, True], ids=['byok-main', 'managed-main'])
@pytest.mark.parametrize('phase', ['turn_start', 'post_tool'])
@pytest.mark.parametrize('summary_failure', ['transport', 'empty'])
def test_unknown_compression_stops_real_turn_before_continuation(
    monkeypatch, tmp_path, managed_main, phase, summary_failure,
):
    agent = _make_agent(monkeypatch, tmp_path, max_attempts=3)
    agent._api_call_count = 5
    agent._current_streamed_assistant_text = 'previous turn answer'
    if managed_main:
        agent.api_key = replace(credential(), model=agent.model)
        agent.context_compressor.api_key = agent.api_key
    compressor = agent.context_compressor
    compressor.context_length = 256_000
    compressor.threshold_tokens = 50_000
    compressor.summary_target_ratio = 0.05
    compressor.note_usage_less_response()
    agent._compression_feasibility_checked = True
    history = [
        {'role': 'user' if i % 2 == 0 else 'assistant', 'content': f'message {i} ' + 'x' * 4000}
        for i in range(60)
    ]
    original = deepcopy(history)
    response = _stop_response()
    if phase == 'post_tool':
        response.choices[0].finish_reason = 'tool_calls'
        response.choices[0].message.content = ''
        response.choices[0].message.tool_calls = [SimpleNamespace(
            id='call-read', type='function', function=SimpleNamespace(name='read_file', arguments='{}'))]
        agent.valid_tool_names = {'read_file'}
        should_compress = compressor.should_compress
        monkeypatch.setattr(compressor, 'should_compress', lambda tokens=None: (
            agent.client.chat.completions.create.call_count > 0 and should_compress(tokens)))

        def tool_result(_response, messages, _task_id, _api_calls):
            messages.append({'role': 'tool', 'name': 'read_file', 'tool_call_id': 'call-read',
                             'content': 'already executed tool result'})

        monkeypatch.setattr(agent, '_execute_tool_calls', tool_result)
    agent.client.chat.completions.create.side_effect = [response, _stop_response()]

    def failed_summary(*, route_info, **_kwargs):
        route_info.update(provider='aino', model=agent.model)
        if summary_failure == 'transport':
            raise ManagedOperationUnknown()
        empty = _stop_response()
        empty.choices[0].message.content = ''
        return empty

    with (
        patch('agent.turn_context.estimate_request_tokens_rough', return_value=100_000),
        patch('agent.context_compressor.call_llm', side_effect=failed_summary) as summary,
        patch('agent.turn_context._maybe_title_session_at_turn_start'),
        patch.object(agent, '_save_trajectory'),
        patch.object(agent, '_cleanup_task_resources'),
    ):
        result = agent.run_conversation('continue the task', conversation_history=history)
    assert summary.call_count == 1
    assert agent.client.chat.completions.create.call_count == (1 if phase == 'post_tool' else 0)
    assert not result['completed']
    assert result['failure_reason'] == 'managed_operation_unknown'
    assert result['failure_retryable'] is False
    assert result['api_calls'] == (1 if phase == 'post_tool' else 0)
    assert result.get('partial') is not True
    assert [(row['role'], row['content']) for row in history] == [(row['role'], row['content']) for row in original]
    assert [row['content'] for row in result['messages'][:60]] == [row['content'] for row in original]
    assert any(row.get('content') == 'continue the task' for row in result['messages'])
    if phase == 'post_tool':
        assert any(row.get('content') == 'already executed tool result' for row in result['messages'])
    rows = agent._session_db.get_messages(agent.session_id)
    assert rows[-1]['display_metadata']['error_surface']['code'] == 'managed_operation_unknown'
    assert rows[-1]['display_metadata']['error_surface']['retryable'] is False
