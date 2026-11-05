"""An uncertain image tool call stops the owning turn before another paid generation."""

import base64
import json
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest

from tests.agent.test_managed_operation_retry import credential
from tests.agent.test_preflight_compression_cap_e2e import _config, _make_agent, _stop_response
from tests.plugins.image_gen.test_aino_provider import PNG, image_scope, plugin, rig as _image_rig
from tools.image_generation_tool import IMAGE_GENERATE_SCHEMA

image_rig = _image_rig


def image_agent(monkeypatch, tmp_path, rig):
    agent = _make_agent(monkeypatch, tmp_path, max_attempts=3)
    config = _config(3)
    config["image_gen"] = json.loads((rig.home / "config.yaml").read_text())["image_gen"]
    config["auxiliary"] = {"title_generation": {"enabled": False}}
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: config)
    monkeypatch.setattr("hermes_cli.config.load_config_readonly", lambda: config)
    agent.compression_enabled = False
    agent.tools, agent.valid_tool_names = [IMAGE_GENERATE_SCHEMA], {"image_generate"}
    return agent


def tool_response(call_id):
    call = SimpleNamespace(id=call_id, type="function", function=SimpleNamespace(
        name="image_generate", arguments=json.dumps({"prompt": "a small orange cat"})))
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason="tool_calls", message=SimpleNamespace(
        content="", tool_calls=[call], reasoning=None, reasoning_content=None))], model="test/model", usage=None)


@pytest.mark.parametrize("managed_main,spill,outcome", [
    (False, False, "read"), (True, False, "read"), (False, True, "read"), (True, True, "read"),
    (False, False, "empty_data"), (False, False, "empty_image"), (False, False, "save_error"),
])
def test_accepted_image_response_loss_stops_real_turn_and_keeps_tool_pair(
    image_rig, monkeypatch, tmp_path, managed_main, spill, outcome,
):
    agent = image_agent(monkeypatch, tmp_path, image_rig)
    if managed_main:
        agent.api_key = replace(credential(), model=agent.model)
    accepted = []

    def accept_then_drop(request):
        accepted.append(request)
        if outcome == "read":
            raise httpx.ReadError("upstream accepted but response was lost", request=request)
        data = {"empty_data": [], "empty_image": [{}]}.get(
            outcome, [{"b64_json": base64.b64encode(PNG).decode()}])
        return httpx.Response(200, json={"data": data})

    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client", lambda *_a, **_k:
                        httpx.Client(transport=httpx.MockTransport(accept_then_drop)))
    provider = plugin()
    monkeypatch.setattr("tools.image_generation_tool._get_plugin_provider", lambda *_a, **_k: provider)
    if spill:
        monkeypatch.setattr("agent.tool_executor.maybe_persist_tool_result", lambda **kwargs: "Result saved to fixture file")
    if outcome == "save_error":
        def fail_save(*args, **kwargs):
            raise OSError("fixture cache write failed")
        monkeypatch.setattr("plugins.image_gen._common.save_b64_image", fail_save)
    agent.client.chat.completions.create.side_effect = [tool_response("image-1"), tool_response("image-2"), _stop_response()]
    history = [{"role": "user", "content": "previous question"}, {"role": "assistant", "content": "previous answer"}]
    before = deepcopy(history)
    with image_scope(image_rig.binding), patch.object(agent, "_save_trajectory"), patch.object(agent, "_cleanup_task_resources"):
        result = agent.run_conversation("Generate an orange cat", conversation_history=history)
    assert len(accepted) == 1
    assert agent.client.chat.completions.create.call_count == 1
    assert result["failed"] and not result["completed"]
    assert result["failure_reason"] == "managed_operation_unknown"
    assert result["failure_retryable"] is False
    assert [{key: value for key, value in row.items() if key != "_db_persisted"} for row in history] == before
    tool_rows = [row for row in result["messages"] if row["role"] == "tool"]
    assert len(tool_rows) == 1 and tool_rows[0]["tool_call_id"] == "image-1"
    if not spill:
        payload = json.loads(tool_rows[0]["content"])
        assert payload["failure_reason"] == "managed_operation_unknown"
        assert payload["failure_retryable"] is False
    assert tool_rows[0]["display_metadata"]["terminal_failure"]["failure_retryable"] is False
    rows = agent._session_db.get_messages(agent.session_id)
    assert rows[-3]["role"] == "assistant" and rows[-3]["tool_calls"][0]["id"] == "image-1"
    assert rows[-2]["role"] == "tool" and rows[-2]["tool_call_id"] == "image-1"
    assert rows[-1]["display_metadata"]["error_surface"]["retryable"] is False


@pytest.mark.parametrize("failure", ["connect", 400, 429])
def test_proven_rejected_image_error_keeps_existing_retry_behavior(image_rig, monkeypatch, tmp_path, failure):
    agent = image_agent(monkeypatch, tmp_path, image_rig)
    attempts = []

    def serve(request):
        attempts.append(request)
        if len(attempts) == 1:
            if failure == "connect":
                raise httpx.ConnectError("connection never established", request=request)
            return httpx.Response(failure, json={"error": {"message": "fixture rejection"}})
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})

    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client", lambda *_a, **_k:
                        httpx.Client(transport=httpx.MockTransport(serve)))
    provider = plugin()
    monkeypatch.setattr("tools.image_generation_tool._get_plugin_provider", lambda *_a, **_k: provider)
    agent.client.chat.completions.create.side_effect = [tool_response("image-1"), tool_response("image-2"), _stop_response()]
    with image_scope(image_rig.binding), patch.object(agent, "_save_trajectory"), patch.object(agent, "_cleanup_task_resources"):
        result = agent.run_conversation("Generate an orange cat")
    assert len(attempts) == 2
    assert agent.client.chat.completions.create.call_count == 3
    assert result["completed"] and not result["failed"]


def test_image_api_unknown_claim_keeps_terminal_result_contract(image_rig, monkeypatch):
    def serve(request):
        return httpx.Response(409, json={"error": {"code": "DESKTOP_OPERATION_UNKNOWN", "message": "fixture"}})

    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client", lambda *_a, **_k:
                        httpx.Client(transport=httpx.MockTransport(serve)))
    with image_scope(image_rig.binding):
        result = plugin().generate("a small orange cat")
    assert result["success"] is False
    assert result["failure_reason"] == "managed_operation_unknown"
    assert result["failure_retryable"] is False


def test_image_source_io_failure_before_dispatch_keeps_existing_behavior(image_rig, monkeypatch):
    def fail_source(*args, **kwargs):
        raise OSError("fixture source unavailable")

    requests = []
    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": []})

    monkeypatch.setattr("plugins.image_gen.openai._named_bytes_io", fail_source)
    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client", lambda *_a, **_k:
                        httpx.Client(transport=httpx.MockTransport(serve)))
    with image_scope(image_rig.binding):
        result = plugin().generate("edit", image_url="https://fixture.invalid/source.png")
    assert not requests
    assert result["error_type"] == "io_error"
    assert "failure_reason" not in result
