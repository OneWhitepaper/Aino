"""A named relay can opt out of message IDs without losing its Responses history."""

from copy import deepcopy
import json
from types import SimpleNamespace

import pytest


URL = "https://relay.example/v1"
MODEL = "gpt-5.4"
ENTRIES = [
    {"name": "fixture", "provider_key": "fixture", "base_url": URL, "responses_replay_item_ids": False},
    {"name": "other", "provider_key": "other", "base_url": URL, "responses_replay_item_ids": True},
]
HISTORY = [
    {"role": "user", "content": "Check the page"},
    {"role": "assistant", "content": "Checking", "codex_message_items": [{
        "type": "message", "role": "assistant", "id": "msg_previous",
        "status": "completed", "phase": "commentary",
        "content": [{"type": "output_text", "text": "Checking"}],
    }]},
    {"role": "assistant", "content": "", "codex_reasoning_items": [{
        "type": "reasoning", "encrypted_content": "fixture-sealed-reasoning", "summary": [],
    }], "tool_calls": [{
        "id": "call_page", "type": "function",
        "function": {"name": "read_file", "arguments": "{}"},
    }]},
    {"role": "tool", "tool_call_id": "call_page", "content": "page contents"},
]


def _assert_history(wire, *, keeps_id):
    message = next(item for item in wire["input"] if item.get("role") == "assistant")
    assert ("id" in message) is keeps_id
    assert message["content"] == [{"type": "output_text", "text": "Checking"}]
    assert message["phase"] == "commentary" and message["status"] == "completed"
    assert next(item for item in wire["input"] if item.get("type") == "reasoning")["encrypted_content"] == "fixture-sealed-reasoning"
    call = next(item for item in wire["input"] if item.get("type") == "function_call")
    output = next(item for item in wire["input"] if item.get("type") == "function_call_output")
    assert call["call_id"] == output["call_id"] == "call_page"
    assert output["output"] == "page contents"
    assert wire["prompt_cache_key"]


@pytest.mark.parametrize(("requested", "url", "keeps_id"), [
    ("custom:fixture", URL, False),
    ("custom:other", URL, True),
    ("custom:fixture", "https://fallback.example/v1", True),
    ("custom:fixture", "https://relay.example/other/v1", True),
    ("custom", URL, True),
    ("openai", URL, True),
])
def test_main_replay_option_is_bound_to_named_provider_and_endpoint(requested, url, keeps_id):
    from agent.chat_completion_helpers import _build_codex_kwargs
    from agent.codex_responses_adapter import classify_responses_route
    from agent.transports.codex import ResponsesApiTransport

    transport = ResponsesApiTransport()
    agent = SimpleNamespace(
        provider="custom", requested_provider=requested, base_url=url,
        _custom_providers=deepcopy(ENTRIES), model=MODEL, max_tokens=None,
        session_id="replay-contract", _get_transport=lambda: transport,
        _prepare_messages_for_non_vision_model=lambda messages: messages,
        _resolved_api_call_timeout=lambda: None,
    )
    history = deepcopy(HISTORY)
    wire = _build_codex_kwargs(agent, history, [], {"enabled": True, "effort": "low"}, {}, "replay-contract")
    # The same endpoint decision also owns the final middleware/preflight boundary.
    injected = deepcopy(wire)
    next(item for item in injected["input"] if item.get("role") == "assistant")["id"] = "msg_previous"
    final = transport.preflight_kwargs(injected, drop_replay_item_ids=not classify_responses_route(agent).endpoint.replay_item_ids)
    _assert_history(wire, keeps_id=keeps_id)
    _assert_history(final, keeps_id=keeps_id)
    assert history == HISTORY


@pytest.mark.parametrize(("name", "keeps_id"), [("fixture", False), ("other", True)])
def test_auxiliary_named_provider_uses_the_same_replay_option(tmp_path, monkeypatch, name, keeps_id):
    from agent.auxiliary_client import resolve_provider_client

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    config = {"providers": {entry["name"]: {
        "api": entry["base_url"], "api_key": "no-key-required", "transport": "codex_responses",
        "default_model": MODEL, "responses_replay_item_ids": entry["responses_replay_item_ids"],
    } for entry in ENTRIES}}
    (tmp_path / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    client, model = resolve_provider_client(f"custom:{name}", MODEL)
    assert model == MODEL
    try:
        wire, _, _ = client.chat.completions._build_responses_kwargs({"model": MODEL, "messages": deepcopy(HISTORY)})
        _assert_history(wire, keeps_id=keeps_id)
    finally:
        client.close()
