"""Managed vision uncertainty is terminal at the registered image/video boundary."""

import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
import pytest

from agent.auxiliary_billing_scope import BillingScope, billing_scope
from agent.auxiliary_client import scoped_runtime_main
from tests.tools.test_vision_tools import VALID_PNG
from tests.tui_gateway.test_managed_model_agent import managed_gateway as _managed_gateway
from tools import vision_tools
from tools.registry import registry
from tui_gateway.managed_session import runtime_for_session

managed_gateway = _managed_gateway


def _media_args(tmp_path, kind):
    path = tmp_path / ("fixture.png" if kind == "image" else "fixture.mp4")
    path.write_bytes(VALID_PNG if kind == "image" else b"\x00\x00\x00\x18ftypmp42")
    return {f"{kind}_url": str(path), "question": "Describe the fixture"}


def _controlled_response(request, text):
    return httpx.Response(200, request=request, json={
        "id": "accepted-vision", "object": "chat.completion", "created": 1,
        "model": "fixture-upstream", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11},
    })


def _run_registered(runtime, model, tool, args):
    scope = BillingScope("aino", runtime["api_key"].user_id,
                         runtime["api_key"].session_id, str(uuid4()), "chat")
    token = billing_scope.set(scope)
    try:
        with scoped_runtime_main({**runtime, "model": model}):
            return json.loads(registry.dispatch(tool, args))
    finally:
        billing_scope.reset(token)


@pytest.mark.parametrize("kind,tool", [("image", "vision_analyze"), ("video", "video_analyze")])
@pytest.mark.parametrize("outcome", ["empty", "response_lost"])
def test_managed_vision_stops_after_one_accepted_call_and_returns_terminal_metadata(
    managed_gateway, monkeypatch, tmp_path, kind, tool, outcome,
):
    fixture = managed_gateway
    sid = fixture.create()["session_id"]
    fixture.bind(sid, vision=True)
    model, runtime = runtime_for_session(sid)
    accepted = []
    original_send = httpx.AsyncClient._send_single_request

    async def dispatch(client, request):
        if request.url.path != "/v1/chat/completions":
            return await original_send(client, request)
        accepted.append(request)
        if outcome == "response_lost":
            raise httpx.ReadError("accepted vision response was lost", request=request)
        return _controlled_response(request, "" if len(accepted) == 1 else "unsafe second execution")

    monkeypatch.setattr(httpx.AsyncClient, "_send_single_request", dispatch)
    monkeypatch.setattr(vision_tools, "_should_use_native_vision_fast_path", lambda: False)
    result = _run_registered(runtime, model, tool, _media_args(tmp_path, kind))
    assert len(accepted) == 1
    assert accepted[0].headers["x-aino-purpose"] == "vision"
    assert result["success"] is False
    assert result["failure_reason"] == "managed_operation_unknown"
    assert result["failure_retryable"] is False
    assert result["error_type"] == "managed_operation_unknown"


@pytest.mark.parametrize("kind,tool", [("image", "vision_analyze"), ("video", "video_analyze")])
def test_explicit_byok_vision_override_retains_empty_retry(
    managed_gateway, monkeypatch, tmp_path, kind, tool,
):
    import hermes_yaml as yaml

    fixture = managed_gateway
    sid = fixture.create()["session_id"]
    fixture.bind(sid, vision=True)
    model, runtime = runtime_for_session(sid)
    config_path = tmp_path / "config.yaml"
    config = yaml.safe_load(config_path.read_text())
    config["auxiliary"]["vision"] = {"provider": "custom:fixture-byok"}
    config_path.write_text(yaml.safe_dump(config))
    accepted = []
    original_send = httpx.AsyncClient._send_single_request

    async def dispatch(client, request):
        if request.url.path != "/v1/chat/completions":
            return await original_send(client, request)
        accepted.append(request)
        return _controlled_response(request, "" if len(accepted) == 1 else "Recovered BYOK analysis")

    monkeypatch.setattr(httpx.AsyncClient, "_send_single_request", dispatch)
    monkeypatch.setattr(vision_tools, "_should_use_native_vision_fast_path", lambda: False)
    result = _run_registered(runtime, model, tool, _media_args(tmp_path, kind))
    assert len(accepted) == 2
    assert all(request.headers["authorization"] == "Bearer byok-fixture-key" for request in accepted)
    assert all("x-aino-operation-id" not in request.headers for request in accepted)
    assert result["success"] is True
    assert result["analysis"] == "Recovered BYOK analysis"


@pytest.mark.parametrize("spill", [False, True], ids=["inline-result", "spilled-result"])
def test_unknown_vision_tool_stops_real_byok_turn_before_model_continuation(
    monkeypatch, tmp_path, spill,
):
    from agent.managed_inference_errors import ManagedOperationUnknown
    from tests.agent.test_preflight_compression_cap_e2e import _config, _make_agent, _stop_response

    agent = _make_agent(monkeypatch, tmp_path, max_attempts=3)
    config = _config(3)
    config["auxiliary"] = {"title_generation": {"enabled": False}}
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: config)
    monkeypatch.setattr("hermes_cli.config.load_config_readonly", lambda: config)
    agent.compression_enabled = False
    agent.tools, agent.valid_tool_names = [vision_tools.VISION_ANALYZE_SCHEMA], {"vision_analyze"}
    args = _media_args(tmp_path, "image")
    accepted = []

    async def accepted_then_unknown(**kwargs):
        accepted.append(kwargs)
        raise ManagedOperationUnknown()

    def tool_response(call_id):
        call = SimpleNamespace(id=call_id, type="function", function=SimpleNamespace(
            name="vision_analyze", arguments=json.dumps(args)))
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason="tool_calls", message=SimpleNamespace(
            content="", tool_calls=[call], reasoning=None, reasoning_content=None))], model="test/model", usage=None)

    monkeypatch.setattr(vision_tools, "async_call_llm", accepted_then_unknown)
    monkeypatch.setattr(vision_tools, "_should_use_native_vision_fast_path", lambda: False)
    if spill:
        monkeypatch.setattr("agent.tool_executor.maybe_persist_tool_result", lambda **kwargs: "Saved fixture result")
    agent.client.chat.completions.create.side_effect = [tool_response("vision-1"), tool_response("vision-2"), _stop_response()]
    with patch.object(agent, "_save_trajectory"), patch.object(agent, "_cleanup_task_resources"):
        result = agent.run_conversation("Describe the fixture image")
    assert len(accepted) == 1
    assert agent.client.chat.completions.create.call_count == 1
    assert result["failed"] and not result["completed"]
    assert result["failure_reason"] == "managed_operation_unknown"
    assert result["failure_retryable"] is False
    tools = [row for row in result["messages"] if row["role"] == "tool"]
    assert len(tools) == 1 and tools[0]["tool_call_id"] == "vision-1"
    assert tools[0]["display_metadata"]["terminal_failure"]["failure_retryable"] is False
    rows = agent._session_db.get_messages(agent.session_id)
    assert rows[-3]["role"] == "assistant" and rows[-3]["tool_calls"][0]["id"] == "vision-1"
    assert rows[-2]["role"] == "tool" and rows[-2]["tool_call_id"] == "vision-1"
    assert rows[-1]["display_metadata"]["error_surface"]["retryable"] is False
