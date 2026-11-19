"""The local protocol adapter must finish real tools, not invent success on EOF."""

import json
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet


def _codec():
    from agent.transports.aino_code.replay import ReplayCodec
    return ReplayCodec(Fernet.generate_key(), "fixture-route")


def _request(tools=None):
    return SimpleNamespace(body={"model": "fixture-exact-model"}, tools=tools or {})


def _events(frames, mode="chat_completions", tools=None):
    from agent.transports.aino_code.protocol_stream import response_events
    data = "".join("data: " + (x if isinstance(x, str) else json.dumps(x)) + "\n\n" for x in frames)
    response = httpx.Response(200, headers={"content-type": "text/event-stream"}, content=data)
    return list(response_events(response, _request(tools), mode, _codec()))


def _chunk(delta=None, finish=None, **extra):
    return {"choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}], **extra}


def test_chat_stream_preserves_text_tools_usage_and_custom_tool_identity():
    events = _events([
        _chunk({"content": "Checking…"}),
        _chunk({"tool_calls": [{"index": 0, "id": "call-1", "type": "function",
                               "function": {"name": "patch", "arguments": '{"input":"'}}]}),
        _chunk({"tool_calls": [{"index": 0, "function": {"arguments": '*** patch"}'}}]}),
        _chunk(finish="tool_calls"),
        {"choices": [], "usage": {"prompt_tokens": 9, "completion_tokens": 4,
                                   "prompt_tokens_details": {"cached_tokens": 3}}}, "[DONE]"
    ], tools={"patch": {"name": "apply_patch", "type": "custom"}})
    assert any(e.get("delta") == "Checking…" for e in events)
    final = events[-1]
    assert final["type"] == "response.completed"
    output = final["response"]["output"]
    assert output[0]["content"][0]["text"] == "Checking…"
    assert output[1] | {"id": "ignored"} == {
        "id": "ignored", "type": "custom_tool_call", "status": "completed",
        "name": "apply_patch", "call_id": "call-1", "input": "*** patch"}
    assert final["response"]["usage"] == {
        "input_tokens": 9, "output_tokens": 4, "total_tokens": 13,
        "input_tokens_details": {"cached_tokens": 3}}


@pytest.mark.parametrize("frames", [
    [_chunk({"content": "partial"})],
    [_chunk({"content": "partial"}), "[DONE]"],
    [{"error": {"message": "upstream-secret-must-not-escape"}}],
    [_chunk({"tool_calls": [{"index": 0, "id": "call", "function": {
        "name": "shell", "arguments": "{bad"}}]}, "tool_calls"), "[DONE]"],
])
def test_incomplete_or_invalid_stream_never_finishes_a_tool_or_response(frames):
    from agent.transports.aino_code.protocol_stream import response_events
    response = httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content="".join("data: " + (x if isinstance(x, str) else json.dumps(x))
                                              + "\n\n" for x in frames))
    observed = []
    with pytest.raises(ValueError) as caught:
        observed.extend(response_events(response, _request({"shell": {"name": "shell", "type": "function"}}),
                                        "chat_completions", _codec()))
    assert "upstream-secret" not in str(caught.value)
    assert not any(e["type"] in {"response.completed", "response.output_item.done"} for e in observed)


def test_anthropic_signed_thinking_and_tool_roundtrip_metadata_survive_stream():
    from agent.transports.aino_code.protocol_stream import response_events
    codec = _codec()
    frames = [
        {"type": "message_start", "message": {"id": "msg-1", "usage": {"input_tokens": 5,
            "cache_read_input_tokens": 6, "cache_creation_input_tokens": 2}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "reason"}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "signed-native"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tool-1", "name": "shell", "input": {}}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"cmd":"pwd"}'}},
        {"type": "content_block_stop", "index": 1},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 7}},
        {"type": "message_stop"},
    ]
    response = httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content="".join("data: " + json.dumps(x) + "\n\n" for x in frames))
    events = list(response_events(response, _request({"shell": {"name": "exec_command", "type": "function"}}),
                                  "anthropic_messages", codec))
    final = events[-1]["response"]
    reason, call = final["output"]
    assert reason["type"] == "reasoning"
    assert codec.open(reason["encrypted_content"])["anthropic"]["content"] == [
        {"type": "thinking", "thinking": "reason", "signature": "signed-native"},
        {"type": "tool_use", "id": "tool-1", "name": "shell", "input": {"cmd": "pwd"}},
    ]
    assert call["name"] == "exec_command" and json.loads(call["arguments"]) == {"cmd": "pwd"}
    assert final["usage"]["input_tokens"] == 13


def test_json_response_is_converted_without_an_extra_model_request():
    from agent.transports.aino_code.protocol_stream import response_events
    response = httpx.Response(200, json={"object": "chat.completion", "choices": [
        {"index": 0, "message": {"role": "assistant", "content": "done"}, "finish_reason": "stop"}]})
    events = list(response_events(response, _request(), "chat_completions", _codec()))
    assert events[-1]["type"] == "response.completed"
    assert events[-1]["response"]["output"][0]["content"][0]["text"] == "done"


def test_truncation_is_not_reported_as_success():
    events = _events([_chunk({"content": "too long"}, "length"), "[DONE]"])
    assert events[-1]["type"] == "response.incomplete"
    assert events[-1]["response"]["incomplete_details"]["reason"] == "max_output_tokens"


def test_invalid_late_usage_does_not_release_an_already_buffered_tool():
    from agent.transports.aino_code.protocol_stream import response_events
    frames = [_chunk({"tool_calls": [{"index": 0, "id": "call-1", "function": {
        "name": "shell", "arguments": '{"cmd":"pwd"}'}}]}, "tool_calls"),
        {"choices": [], "usage": {"prompt_tokens": "invalid", "completion_tokens": 3}}, "[DONE]"]
    response = httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content="".join("data: " + (x if isinstance(x, str) else json.dumps(x)) + "\n\n" for x in frames))
    observed = []
    with pytest.raises(ValueError):
        observed.extend(response_events(response, _request({"shell": {"name": "shell", "type": "function"}}),
                                        "chat_completions", _codec()))
    assert not any(e["type"] == "response.output_item.done" for e in observed)


def test_replay_codec_is_persistent_private_and_bound_to_route(tmp_path):
    from agent.transports.aino_code.replay import ReplayCodec, load_replay_key
    home = tmp_path / "code"
    home.mkdir()
    key = load_replay_key(home)
    token = ReplayCodec(key, "profile:model:route").seal({"chat": {"reasoning_content": "private reasoning"}})
    assert "private reasoning" not in token
    assert ReplayCodec(load_replay_key(home), "profile:model:route").open(token)["chat"]["reasoning_content"] == "private reasoning"
    assert ReplayCodec(key, "different-route").open(token) == {}
    with pytest.raises(ValueError):
        ReplayCodec(key, "profile:model:route").open(token[:-5] + "xxxxx")


def test_replay_key_does_not_follow_symlinks(tmp_path):
    from agent.transports.aino_code.replay import load_replay_key
    target = tmp_path / "outside"
    target.write_text("keep")
    (tmp_path / "protocol-replay.key").symlink_to(target)
    with pytest.raises(ValueError):
        load_replay_key(tmp_path)
    assert target.read_text() == "keep"
