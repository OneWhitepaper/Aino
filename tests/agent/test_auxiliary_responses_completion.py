"""Auxiliary Responses output must not claim a partial answer completed successfully."""

from types import SimpleNamespace

import pytest

from agent.auxiliary_client import _CodexCompletionsAdapter


@pytest.mark.parametrize("status,reason,expected", [
    ("completed", None, "stop"),
    ("incomplete", "max_output_tokens", "length"),
    ("incomplete", "content_filter", "content_filter"),
    ("incomplete", "other", "incomplete"),
    ("failed", None, "error"),
    ("cancelled", None, "cancelled"),
    ("in_progress", None, "in_progress"),
    (None, None, "unknown"),
])
@pytest.mark.parametrize("streamed", [False, True])
@pytest.mark.parametrize("with_tools", [False, True])
def test_auxiliary_preserves_provider_completion_status(status, reason, expected, streamed, with_tools):
    final = SimpleNamespace(
        status=status, incomplete_details={"reason": reason},
        usage=SimpleNamespace(input_tokens=17, output_tokens=5, total_tokens=22),
        output=[SimpleNamespace(type="message", content=[
            SimpleNamespace(type="output_text", text="Partial or complete public context")])],
    )
    if with_tools:
        final.output.append(SimpleNamespace(
            type="function_call", call_id="call_one", name="publish", arguments='{"text":"context"}'))
    response = final
    if streamed:
        event_type = {"completed": "response.completed", "incomplete": "response.incomplete",
                      "failed": "response.failed", "cancelled": "response.failed"}.get(status, "response.completed")
        response = iter([*(SimpleNamespace(type="response.output_item.done", item=item) for item in final.output),
                         SimpleNamespace(type=event_type, response=final)])
    client = SimpleNamespace(
        base_url="https://chatgpt.com/backend-api/codex",
        responses=SimpleNamespace(create=lambda **kwargs: response),
    )
    result = _CodexCompletionsAdapter(client, "gpt-5").create(
        messages=[{"role": "user", "content": "Summarize the public context"}])
    choice = result.choices[0]
    assert choice.message.content == "Partial or complete public context"
    assert choice.finish_reason == ("tool_calls" if with_tools and status == "completed" else expected)
    assert result.model == "gpt-5"
    assert result.usage.prompt_tokens == final.usage.input_tokens
    assert result.usage.completion_tokens == final.usage.output_tokens
    assert result.usage.total_tokens == final.usage.total_tokens
    if with_tools:
        tool = choice.message.tool_calls[0]
        assert (tool.id, tool.function.name, tool.function.arguments) == (
            "call_one", "publish", '{"text":"context"}')
    else:
        assert choice.message.tool_calls is None


@pytest.mark.parametrize("terminal", [None, "response.incomplete", "response.failed"])
def test_auxiliary_stream_requires_completion_evidence(terminal):
    events = [{"type": "response.output_text.delta", "delta": "Partial context"}]
    if terminal is not None:
        events.append({"type": terminal, "response": {"incomplete_details": {"reason": "max_output_tokens"}}})
    client = SimpleNamespace(
        base_url="https://chatgpt.com/backend-api/codex",
        responses=SimpleNamespace(create=lambda **kwargs: iter(events)),
    )
    result = _CodexCompletionsAdapter(client, "gpt-5").create(
        messages=[{"role": "user", "content": "Summarize the public context"}])
    assert result.choices[0].message.content == "Partial context"
    assert result.choices[0].finish_reason not in {"stop", "tool_calls"}
