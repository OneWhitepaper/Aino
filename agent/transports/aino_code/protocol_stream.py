"""Translate completed Chat/Messages streams into native Codex Responses events.

Only text is published speculatively. A tool is never released to Codex until
the upstream termination and every tool argument have been validated.
"""

import json
from codecs import getincrementaldecoder
from dataclasses import dataclass, field
from io import IncrementalNewlineDecoder
from uuid import uuid4


def _stream_frames(response):
    decoder = IncrementalNewlineDecoder(getincrementaldecoder("utf-8")(), translate=True)
    pending, data = "", []
    size = 0
    for chunk in response.iter_bytes():
        size += len(chunk)
        if size > 32 * 1024 * 1024:
            raise ValueError("The model response exceeded the protocol adapter's size limit.")
        lines = (pending + decoder.decode(chunk)).split("\n")
        pending = lines.pop()
        if len(pending) > 2 * 1024 * 1024:
            raise ValueError("The model sent an oversized stream frame.")
        for line in lines:
            if line.startswith("data:"):
                data.append(line[5:].lstrip(" "))
            elif not line and data:
                raw, data = "\n".join(data), []
                if raw == "[DONE]":
                    yield None
                    return
                try:
                    frame = json.loads(raw)
                except ValueError:
                    raise ValueError("The model sent an invalid stream frame.") from None
                if not isinstance(frame, dict) or frame.get("error"):
                    raise ValueError("The model returned an error or invalid stream frame.")
                yield frame
    if data or (pending + decoder.decode(b"", final=True)).strip():
        raise ValueError("The model stream ended inside an unfinished frame.")


def _frames(response, mode):
    content_type = response.headers.get("content-type", "").lower()
    if "text/event-stream" in content_type:
        yield from _stream_frames(response)
        return
    if "application/json" not in content_type:
        raise ValueError("The model returned neither JSON nor an event stream.")
    raw = bytearray()
    for chunk in response.iter_bytes():
        raw.extend(chunk)
        if len(raw) > 32 * 1024 * 1024:
            raise ValueError("The model response exceeded the protocol adapter's size limit.")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise ValueError("The model returned invalid JSON.") from None
    if not isinstance(payload, dict) or payload.get("error"):
        raise ValueError("The model returned an error or invalid JSON response.")
    if mode == "chat_completions":
        choices = payload.get("choices")
        if payload.get("object") != "chat.completion" or not isinstance(choices, list):
            raise ValueError("The model did not return a Chat Completions response.")
        yield {**payload, "choices": [{**choice, "delta": choice.get("message", {})} for choice in choices]}
    else:
        if payload.get("type") != "message" or payload.get("role") != "assistant":
            raise ValueError("The model did not return an Anthropic Messages response.")
        yield {"type": "message_start", "message": {"usage": payload.get("usage", {})}}
        for index, block in enumerate(payload.get("content", [])):
            yield {"type": "content_block_start", "index": index, "content_block": block}
            yield {"type": "content_block_stop", "index": index}
        yield {"type": "message_delta", "delta": {"stop_reason": payload.get("stop_reason")}}
        yield {"type": "message_stop"}
    yield None


@dataclass
class _Completion:
    text: str = ""
    reasoning: str = ""
    calls: dict = field(default_factory=dict)
    native_blocks: dict = field(default_factory=dict)
    open_blocks: set = field(default_factory=set)
    chat_metadata: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)
    finish: str | None = None
    ended: bool = False


def _chat_tools(state, calls):
    for position, delta in enumerate(calls):
        index = delta.get("index", position)
        if not isinstance(index, int) or index < 0 or index > 1024:
            raise ValueError("The model sent an invalid tool index.")
        tool = state.calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
        if delta.get("id"):
            if tool["id"] and tool["id"] != delta["id"]:
                raise ValueError("The model changed a tool call identity mid-stream.")
            tool["id"] = delta["id"]
        function = delta.get("function") or {}
        for key in ("name", "arguments"):
            value = function.get(key)
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError("The model sent invalid tool data.")
                tool[key] += value


def _feed_chat(state, frame):
    if frame is None:
        state.ended = True
        return ""
    if isinstance(frame.get("usage"), dict):
        state.usage.update(frame["usage"])
    text = ""
    choices = frame.get("choices")
    if not isinstance(choices, list) or len(choices) > 1:
        raise ValueError("The model sent an invalid completion choice.")
    for choice in choices:
        if choice.get("index", 0) != 0 or state.finish:
            raise ValueError("The model sent an unexpected completion choice.")
        delta = choice.get("delta") or {}
        content = delta.get("content")
        if content is not None:
            if not isinstance(content, str):
                raise ValueError("The model sent unsupported assistant content.")
            text += content
        for key in ("reasoning_content", "reasoning"):
            value = delta.get(key)
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError("The model sent invalid reasoning content.")
                state.chat_metadata[key] = state.chat_metadata.get(key, "") + value
                state.reasoning += value
        if isinstance(delta.get("reasoning_details"), list):
            state.chat_metadata.setdefault("reasoning_details", []).extend(delta["reasoning_details"])
        _chat_tools(state, delta.get("tool_calls") or [])
        state.finish = choice.get("finish_reason")
    state.text += text
    return text


def _message_start(state, frame):
    state.usage.update(frame.get("message", {}).get("usage") or {})
    return ""


def _block_start(state, frame):
    index, block = frame.get("index"), frame.get("content_block")
    if not isinstance(index, int) or index < 0 or index > 1024 or index in state.native_blocks or not isinstance(block, dict):
        raise ValueError("The model sent an invalid content block.")
    if block.get("type") not in {"text", "thinking", "redacted_thinking", "tool_use"}:
        raise ValueError("The model returned a server-side tool or unsupported content block.")
    state.native_blocks[index] = dict(block)
    state.open_blocks.add(index)
    text = block.get("text", "") if block["type"] == "text" else ""
    state.text += text
    if block["type"] == "thinking":
        state.reasoning += block.get("thinking", "")
    return text


def _block_delta(state, frame):
    index, delta = frame.get("index"), frame.get("delta") or {}
    if index not in state.open_blocks:
        raise ValueError("The model sent a delta outside an open block.")
    block = state.native_blocks[index]
    fields = {"text_delta": ("text", "text", "text"), "thinking_delta": ("thinking", "thinking", "thinking"),
              "signature_delta": ("signature", "signature", "thinking"),
              "input_json_delta": ("_json", "partial_json", "tool_use")}
    field_info = fields.get(delta.get("type"))
    if not field_info:
        raise ValueError("The model sent an unsupported content delta.")
    target, source, kind = field_info
    value = delta.get(source)
    if block.get("type") != kind or not isinstance(value, str):
        raise ValueError("The model sent a mismatched content delta.")
    block[target] = block.get(target, "") + value
    if target == "text":
        state.text += value
        return value
    if target == "thinking":
        state.reasoning += value
    return ""


def _block_stop(state, frame):
    index = frame.get("index")
    if index not in state.open_blocks:
        raise ValueError("The model ended an unknown content block.")
    state.open_blocks.remove(index)
    block = state.native_blocks[index]
    if block["type"] == "tool_use":
        raw = block.pop("_json", None)
        try:
            arguments = json.loads(raw) if raw is not None else block.get("input")
        except ValueError:
            raise ValueError("The model returned incomplete tool arguments.") from None
        if not isinstance(arguments, dict):
            raise ValueError("The model returned invalid tool arguments.")
        block["input"] = arguments
        state.calls[index] = {"id": block.get("id"), "name": block.get("name"), "arguments": json.dumps(arguments)}
    return ""


def _message_delta(state, frame):
    state.finish = (frame.get("delta") or {}).get("stop_reason") or state.finish
    state.usage.update(frame.get("usage") or {})
    return ""


def _message_stop(state, _frame):
    if state.open_blocks:
        raise ValueError("The model ended before its content blocks were complete.")
    state.ended = True
    return ""


_MESSAGE_EVENTS = {"message_start": _message_start, "content_block_start": _block_start,
                   "content_block_delta": _block_delta, "content_block_stop": _block_stop,
                   "message_delta": _message_delta, "message_stop": _message_stop}


def _feed_messages(state, frame):
    if frame is None or frame.get("type") == "ping":
        return ""
    handler = _MESSAGE_EVENTS.get(frame.get("type"))
    if handler is None or state.ended:
        raise ValueError("The model returned an error or unexpected Messages event.")
    return handler(state, frame)


def _tool_items(state, tools):
    result, ids = [], set()
    for call in state.calls.values():
        identity = tools.get(call["name"])
        if not identity or not isinstance(call["id"], str) or not call["id"] or call["id"] in ids:
            raise ValueError("The model returned an unknown or invalid tool call.")
        try:
            arguments = json.loads(call["arguments"])
        except (ValueError, TypeError):
            raise ValueError("The model returned incomplete tool arguments.") from None
        if not isinstance(arguments, dict):
            raise ValueError("The model returned invalid tool arguments.")
        # Function arguments travel as a JSON string, so serializing the outer
        # event alone cannot catch nested lone surrogates or non-JSON numbers.
        json.dumps(arguments, ensure_ascii=False, allow_nan=False).encode("utf-8")
        custom = identity["type"] == "custom"
        if custom and (not isinstance(arguments.get("input"), str) or set(arguments) != {"input"}):
            raise ValueError("The model returned invalid freeform tool input.")
        item = {"id": "fc_" + uuid4().hex, "type": "custom_tool_call" if custom else "function_call",
                "status": "completed", "call_id": call["id"], "name": identity["name"],
                **({"input": arguments["input"]} if custom else {"arguments": call["arguments"]})}
        if identity.get("namespace"):
            item["namespace"] = identity["namespace"]
        ids.add(call["id"])
        result.append(item)
    return result


def _usage(state, mode):
    usage = state.usage
    if mode == "chat_completions":
        prompt, output = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
    else:
        cached = usage.get("cache_read_input_tokens", 0)
        prompt = usage.get("input_tokens", 0) + cached + usage.get("cache_creation_input_tokens", 0)
        output = usage.get("output_tokens", 0)
    if any(not isinstance(n, int) or n < 0 for n in (prompt, output, cached)):
        raise ValueError("The model returned invalid usage data.")
    return {"input_tokens": prompt, "output_tokens": output, "total_tokens": prompt + output,
            "input_tokens_details": {"cached_tokens": cached}}


def _reasoning_item(state, mode, replay):
    metadata = ({"chat": state.chat_metadata} if mode == "chat_completions" else
                {"anthropic": {"content": list(state.native_blocks.values())}})
    if not state.reasoning and not state.chat_metadata and not state.native_blocks:
        return None
    return {"id": "rs_" + uuid4().hex, "type": "reasoning",
            "summary": [{"type": "summary_text", "text": state.reasoning}] if state.reasoning else [],
            "encrypted_content": replay.seal(metadata)}


def response_events(response, prepared, mode, replay):
    state = _Completion()
    feed = {"chat_completions": _feed_chat, "anthropic_messages": _feed_messages}[mode]
    envelope = {"id": "resp_" + uuid4().hex, "object": "response", "model": prepared.body["model"],
                "status": "in_progress", "output": []}
    message = {"id": "msg_" + uuid4().hex, "type": "message", "role": "assistant", "status": "in_progress",
               "content": [{"type": "output_text", "text": "", "annotations": []}]}
    yield {"type": "response.created", "response": dict(envelope)}
    started = False
    for frame in _frames(response, mode):
        delta = feed(state, frame)
        if delta:
            if not started:
                yield {"type": "response.output_item.added", "output_index": 0, "item": message}
                yield {"type": "response.content_part.added", "output_index": 0, "content_index": 0,
                       "item_id": message["id"], "part": message["content"][0]}
                started = True
            yield {"type": "response.output_text.delta", "output_index": 0, "content_index": 0,
                   "item_id": message["id"], "delta": delta}
    if not state.finish or not state.ended:
        raise ValueError("The model stream ended without a completed response. No automatic retry was made.")
    allowed = {"chat_completions": {"stop", "tool_calls", "length"},
               "anthropic_messages": {"end_turn", "tool_use", "stop_sequence", "max_tokens"}}[mode]
    if state.finish not in allowed:
        raise ValueError("The model refused or could not complete the request.")
    incomplete = state.finish in {"length", "max_tokens"}
    # Validate all calls before releasing any of them, including parallel calls.
    calls = [] if incomplete else _tool_items(state, prepared.tools)
    usage = _usage(state, mode)
    output = []
    if started:
        message = {**message, "status": "completed", "content": [{"type": "output_text", "text": state.text, "annotations": []}]}
        output.append(message)
    reasoning = _reasoning_item(state, mode, replay)
    if reasoning:
        output.append(reasoning)
    output.extend(calls)
    final = {**envelope, "status": "incomplete" if incomplete else "completed", "output": output, "usage": usage}
    if incomplete:
        final["incomplete_details"] = {"reason": "max_output_tokens"}
    # A malformed later tool must not fail UTF-8 serialization after an earlier
    # output_item.done has already authorized execution in Codex.
    json.dumps(final, ensure_ascii=False, allow_nan=False).encode("utf-8")
    for index, item in enumerate(output):
        if index != 0 or not started:
            yield {"type": "response.output_item.added", "output_index": index, "item": item}
        yield {"type": "response.output_item.done", "output_index": index, "item": item}
    yield {"type": "response.incomplete" if incomplete else "response.completed", "response": final}
