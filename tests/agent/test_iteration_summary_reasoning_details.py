"""The max-iterations summary call treats ``reasoning_details`` per api_mode: the
anthropic_messages converter rebuilds signed thinking blocks from it, so the summary messages
must keep it; a strict chat-completions route drops it on the wire via the same kwargs
builder the main loop uses (hermes-agent#70233)."""

import copy
import logging
from types import SimpleNamespace

import pytest

from agent.chat_completion_helpers import _build_api_kwargs_for_mode, _iteration_summary_api_messages
from run_agent import AIAgent
from agent.chat_completion_helpers import _codex_summary_attempt
from agent.turn_request_assembly import assemble_api_request

_HISTORY = [
    {"role": "user", "content": "q"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "t1", "type": "function", "function": {"name": "f", "arguments": "{}"}}],
     "reasoning_details": [{"type": "thinking", "thinking": "x", "signature": "SIG"}]},
    {"role": "tool", "tool_call_id": "t1", "content": "r"},
]


@pytest.fixture
def make_agent(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    def _make(base_url, provider):
        agent = AIAgent(api_key="k", base_url=base_url, provider=provider, model="m", quiet_mode=True,
                        skip_context_files=True, skip_memory=True)
        agent._cached_system_prompt = "SYS"
        return agent
    return _make


def test_anthropic_summary_messages_keep_reasoning_details(make_agent):
    agent = make_agent("https://api.anthropic.com", "anthropic")
    assert agent.api_mode == "anthropic_messages"
    out = _iteration_summary_api_messages(agent, [dict(m) for m in _HISTORY])
    assistant = next(m for m in out if m.get("role") == "assistant")
    assert assistant["reasoning_details"] == _HISTORY[1]["reasoning_details"]


def test_strict_chat_route_summary_wire_drops_reasoning_details(make_agent):
    agent = make_agent("https://api.groq.com/openai/v1", "custom")
    assert agent.api_mode == "chat_completions"
    history = copy.deepcopy(_HISTORY)
    history[1].update(codex_reasoning_items=[{"type": "reasoning", "encrypted_content": "opaque"}],
                      codex_message_items=[{"type": "message", "id": "msg_old"}])
    api_messages = _iteration_summary_api_messages(agent, history)
    kwargs = _build_api_kwargs_for_mode(agent, api_messages)
    assert all("reasoning_details" not in m for m in kwargs["messages"])
    assert all(not {"codex_reasoning_items", "codex_message_items"} & m.keys() for m in api_messages)


def test_responses_summary_preserves_the_ordinary_request_prefix(make_agent, monkeypatch):
    """A final-summary nudge must not erase replay carriers or recanonicalize old calls differently."""
    agent = make_agent("https://api.openai.com/v1", "custom")
    agent.api_mode = "codex_responses"
    agent.model = "gpt-5.6-sol"
    agent._current_turn_timestamp = 0
    agent._use_prompt_caching = False
    agent.ephemeral_system_prompt = "session instructions"
    agent.prefill_messages = [{"role": "assistant", "content": "Prefill"}]
    agent.tools = [{"type": "function", "function": {
        "name": "f", "description": "Read evidence", "parameters": {"type": "object", "properties": {}}}}]
    history = [
        {"role": "user", "content": "display text", "api_content": " wire text "},
        {"role": "assistant", "content": "Checking", "codex_message_items": [{
            "type": "message", "id": "msg_check", "role": "assistant", "status": "completed",
            "phase": "commentary", "content": [{"type": "output_text", "text": "Checking"}]}]},
        {"role": "user", "content": "continue"},
        {"role": "assistant", "content": "", "codex_reasoning_items": [
            {"id": "rs_only", "type": "reasoning", "encrypted_content": "opaque-only", "summary": []}]},
        {"role": "user", "content": "use the evidence"},
        {"role": "assistant", "content": "", "codex_reasoning_items": [
            {"id": "rs_call", "type": "reasoning", "encrypted_content": "opaque-call", "summary": []}],
         "tool_calls": [{"id": "call_evidence", "call_id": "call_evidence", "response_item_id": "fc_evidence",
                         "type": "function", "function": {"name": "f", "arguments": ' { "z": "中文", "a": 1 } '}}]},
        {"role": "tool", "tool_call_id": "call_evidence", "content": " evidence "},
    ]
    original = copy.deepcopy(history)
    prefills = copy.deepcopy(agent.prefill_messages)
    ordinary = assemble_api_request(
        agent, messages=history, current_turn_user_idx=0, _ext_prefetch_cache=None, _plugin_user_context=None,
        moa_config=None, active_system_prompt=agent._cached_system_prompt, original_user_message="display text",
        pending_moa_prepared_request=None, request_logger=logging.getLogger(__name__))
    expected = agent._build_api_kwargs(ordinary.api_messages)
    messages = history + [{"role": "user", "content": "Summarize the evidence."}]
    captured = {}

    def capture(request):
        captured.update(request)
        return SimpleNamespace(status="completed", output=[SimpleNamespace(
            type="message", status="completed", content=[SimpleNamespace(type="output_text", text="Summary")])])

    monkeypatch.setattr(agent, "_run_codex_stream", capture)
    assert _codex_summary_attempt(agent, _iteration_summary_api_messages(agent, messages), "summary")(0) == "Summary"
    assert captured["input"][:-1] == expected["input"]
    for key in ("instructions", "tools", "tool_choice", "parallel_tool_calls", "prompt_cache_key"):
        assert captured[key] == expected[key]
    assert history == original
    assert agent.prefill_messages == prefills
