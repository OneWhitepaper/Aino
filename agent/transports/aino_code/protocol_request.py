"""Pure Responses request translation; routing, credentials and execution stay in the relay."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from types import MappingProxyType

from agent.anthropic_adapter import build_anthropic_kwargs
from agent.anthropic_message_convert import (
    _convert_content_to_anthropic,
    _keep_valid_thinking,
    _sanitize_tool_id,
    assistant_replay_carrier,
)


@dataclass(frozen=True)
class PreparedRequest:
    path: str
    body: dict
    tools: Mapping[str, dict]


@dataclass(frozen=True)
class _ToolCatalog:
    declarations: list[dict]
    identities: Mapping[str, dict]
    history: dict[str, dict] = field(default_factory=dict)

    def resolve(self, item: dict, kind: str, *, historical: bool = False) -> str:
        identity = _tool_identity(item, kind)
        alias = _tool_alias(identity)
        if historical:
            previous = self.identities.get(alias, self.history.get(alias))
            if previous is not None and previous != identity:
                raise ValueError("Historical tool alias collision")
            self.history[alias] = identity
        elif self.identities.get(alias) != identity:
            raise ValueError("Tool choice does not match a declared tool")
        return alias


def _object(value, field: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def _array(value, field: str) -> list:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return value


def _string(value, field: str, *, empty: bool = False) -> str:
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise ValueError(f"{field} must be a string" + ("" if empty else " with content"))
    return value


def _tool_identity(tool: dict, kind: str, namespace: str | None = None) -> dict:
    identity = {"name": _string(tool.get("name"), "tool name"), "type": kind}
    own_namespace = tool.get("namespace")
    if own_namespace is not None and namespace is not None and own_namespace != namespace:
        raise ValueError("Tool namespace conflicts with its enclosing namespace")
    namespace = namespace if namespace is not None else own_namespace
    if namespace is not None:
        identity["namespace"] = _string(namespace, "tool namespace")
    return identity


def _tool_alias(identity: dict) -> str:
    name = identity["name"]
    if "namespace" in identity:
        name = identity["namespace"] + "__" + name
    alias = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    if len(alias) > 64:
        alias = alias[:47] + "_" + hashlib.sha256(name.encode()).hexdigest()[:16]
    return alias


def _function_schema(tool: dict, alias: str) -> dict:
    function = {"name": alias}
    if "description" in tool:
        function["description"] = _string(tool["description"], "tool description", empty=True)
    if tool["type"] == "custom":
        if "format" in tool:
            format_ = _object(tool["format"], "custom tool format")
            if _string(format_.get("type"), "custom format type") not in {"text", "grammar"}:
                raise ValueError("Unsupported custom tool format")
        function["parameters"] = {
            "type": "object", "properties": {"input": {"type": "string"}},
            "required": ["input"], "additionalProperties": False,
        }
    else:
        function["parameters"] = deepcopy(_object(
            tool.get("parameters", {"type": "object", "properties": {}}), "tool parameters"))
        if "strict" in tool:
            if not isinstance(tool["strict"], bool):
                raise ValueError("Tool strict must be boolean")
            function["strict"] = tool["strict"]
    return {"type": "function", "function": function}


def _flatten_tools(tools: list, namespace: str | None = None):
    for raw in tools:
        tool = _object(raw, "tool")
        kind = _string(tool.get("type"), "tool type")
        if kind == "namespace" and namespace is None:
            name = _string(tool.get("name"), "namespace name")
            yield from _flatten_tools(_array(tool.get("tools"), "namespace tools"), name)
        elif kind in {"function", "custom"}:
            yield tool, _tool_identity(tool, kind, namespace)
        else:
            raise ValueError("Unsupported native tool type")


def _catalog(tools) -> _ToolCatalog:
    declarations, identities = [], {}
    for tool, identity in _flatten_tools(_array(tools, "tools")):
        alias = _tool_alias(identity)
        if alias in identities:
            raise ValueError("Tool alias collision or duplicate declaration")
        identities[alias] = identity
        declarations.append(_function_schema(tool, alias))
    return _ToolCatalog(declarations, MappingProxyType(identities))


def _image(part: dict) -> dict:
    url = _string(part.get("image_url"), "input_image image_url")
    if not url.startswith(("https://", "http://", "data:image/")):
        raise ValueError("Unsupported input_image URL")
    if url.startswith("data:") and not re.match(r"data:image/(png|jpe?g|webp|gif);base64,", url, re.IGNORECASE):
        raise ValueError("Unsupported inline image format")
    image = {"url": url}
    if "detail" in part:
        if _string(part["detail"], "image detail") not in {"auto", "low", "high", "original"}:
            raise ValueError("Unsupported input_image detail")
        image["detail"] = part["detail"]
    return {"type": "image_url", "image_url": image}


def _content(value, *, images: bool) -> str | list[dict]:
    if isinstance(value, str):
        return value
    result = []
    for raw in _array(value, "content"):
        part = _object(raw, "content part")
        kind = _string(part.get("type"), "content type")
        if kind in {"input_text", "output_text", "text"}:
            result.append({"type": "text", "text": _string(part.get("text"), "text", empty=True)})
        elif kind == "input_image" and images:
            result.append(_image(part))
        else:
            raise ValueError("Unsupported content type for this role")
    return result


def _message(item: dict, _tools: _ToolCatalog, _replay) -> dict:
    role = _string(item.get("role"), "message role")
    if role not in {"system", "developer", "user", "assistant"}:
        raise ValueError("Unsupported message role")
    return {"role": role, "content": _content(item.get("content"), images=role == "user")}


def _invalid_json_constant(_value):
    raise ValueError("Non-finite values are not valid JSON")


def _call(item: dict, tools: _ToolCatalog, _replay) -> dict:
    kind = {"function_call": "function", "custom_tool_call": "custom"}[item["type"]]
    name = tools.resolve(item, kind, historical=True)
    call_id = _string(item.get("call_id"), "call_id")
    if kind == "custom":
        arguments = json.dumps({"input": _string(item.get("input"), "custom input", empty=True)},
                               ensure_ascii=False, separators=(",", ":"))
    else:
        arguments = _string(item.get("arguments"), "function arguments", empty=True)
        try:
            parsed = json.loads(arguments, parse_constant=_invalid_json_constant)
        except ValueError:
            raise ValueError("Function arguments must be a JSON object") from None
        _object(parsed, "function arguments")
    return {"role": "assistant", "content": None, "tool_calls": [
        {"type": "function", "id": call_id, "function": {"name": name, "arguments": arguments}},
    ]}


def _result(item: dict, _tools: _ToolCatalog, _replay) -> dict:
    return {"role": "tool", "tool_call_id": _string(item.get("call_id"), "call_id"),
            "content": _content(item.get("output"), images=True)}


_REPLAY_BLOCK_FIELDS = {
    "text": ("text",),
    "thinking": ("thinking",),
    "redacted_thinking": ("data",),
    "tool_use": ("id", "name", "input"),
}


def _native_replay_blocks(value) -> list[dict]:
    blocks = _array(value, "anthropic replay content")
    for raw in blocks:
        block = _object(raw, "anthropic replay block")
        kind = _string(block.get("type"), "anthropic replay block type")
        fields = _REPLAY_BLOCK_FIELDS.get(kind)
        if fields is None:
            raise ValueError("Unsupported Anthropic replay block")
        for name in fields:
            if name == "input":
                _object(block.get(name), "replay tool input")
            else:
                _string(block.get(name), "replay " + name, empty=name in {"text", "thinking"})
        if kind == "thinking" and "signature" in block:
            _string(block["signature"], "thinking signature", empty=True)
    return deepcopy(blocks)


def _reasoning(item: dict, _tools: _ToolCatalog, replay) -> dict:
    message = {"role": "assistant", "content": None}
    metadata = {}
    token = item.get("encrypted_content")
    if token is not None:
        _string(token, "encrypted_content")
        if replay is None:
            raise ValueError("Encrypted reasoning requires the scoped replay codec")
        # The codec alone owns token recognition and authentication. Native and
        # other-scope blobs open to {}; invalid tagged ciphertext must fail closed.
        metadata = _object(replay.open(token), "replay metadata")
    chat = _object(metadata.get("chat", {}), "chat replay metadata")
    for key in ("reasoning_content", "reasoning"):
        if key in chat:
            message[key] = _string(chat[key], key, empty=True)
    if "reasoning_details" in chat:
        details = _array(chat["reasoning_details"], "reasoning_details")
        for detail in details:
            _object(detail, "reasoning detail")
        message["reasoning_details"] = deepcopy(details)
    if "anthropic" in metadata:
        native = _object(metadata["anthropic"], "anthropic replay metadata")
        message["anthropic_content_blocks"] = _native_replay_blocks(native.get("content"))
    summary = []
    for raw in _array(item.get("summary", []), "reasoning summary"):
        part = _object(raw, "reasoning summary part")
        if part.get("type") != "summary_text":
            raise ValueError("Unsupported reasoning summary content")
        summary.append(_string(part.get("text"), "summary text", empty=True))
    if summary and not any(key in message for key in ("reasoning", "reasoning_content", "reasoning_details")):
        message["reasoning_content"] = "".join(summary)
    return message


_INPUT_HANDLERS = {
    "message": _message,
    "function_call": _call,
    "custom_tool_call": _call,
    "function_call_output": _result,
    "custom_tool_call_output": _result,
    "reasoning": _reasoning,
}


def _join_content(left, right):
    if left is None:
        return right
    if right is None:
        return left
    if isinstance(left, str) and isinstance(right, str):
        return left + right
    left = [{"type": "text", "text": left}] if isinstance(left, str) else left
    right = [{"type": "text", "text": right}] if isinstance(right, str) else right
    return left + right


def _append_message(messages: list[dict], message: dict) -> None:
    if message == {"role": "assistant", "content": None}:
        return
    if message["role"] != "assistant" or not messages or messages[-1]["role"] != "assistant":
        messages.append(message)
        return
    previous = messages[-1]
    previous["content"] = _join_content(previous["content"], message["content"])
    if "tool_calls" in message:
        previous.setdefault("tool_calls", []).extend(message["tool_calls"])
    for key in ("reasoning_content", "reasoning", "reasoning_details", "anthropic_content_blocks"):
        if key in message:
            previous[key] = previous[key] + message[key] if key in previous else message[key]


def _validate_tool_results(messages: list[dict]) -> None:
    pending, seen = set(), set()
    for message in messages:
        if message["role"] == "tool":
            call_id = message["tool_call_id"]
            if call_id not in pending:
                raise ValueError("Tool result has no matching pending call")
            pending.remove(call_id)
            continue
        if pending:
            raise ValueError("Tool calls must have results before the next message")
        for call in message.get("tool_calls", []):
            call_id = call["id"]
            if call_id in seen:
                raise ValueError("Duplicate tool call_id")
            seen.add(call_id)
            pending.add(call_id)
    if pending:
        raise ValueError("Tool calls are missing results")


def _messages(payload: dict, tools: _ToolCatalog, replay) -> list[dict]:
    messages = []
    if payload.get("instructions") is not None:
        messages.append({"role": "system", "content": _string(payload["instructions"], "instructions", empty=True)})
    inputs = payload.get("input")
    if isinstance(inputs, str):
        inputs = [{"role": "user", "content": inputs}]
    for raw in _array(inputs, "input"):
        item = _object(raw, "input item")
        kind = _string(item.get("type", "message" if "role" in item else None), "input item type")
        if kind == "web_search_call" and item.get("status") == "completed":
            # A resumed Responses thread can contain provider-hosted search traces.
            # Keep the answer and local tool history, not the old search action or opaque state.
            # This only projects history; declaring web_search in tools is still rejected.
            continue
        handler = _INPUT_HANDLERS.get(kind)
        if handler is None:
            raise ValueError("Unsupported Responses input item")
        _append_message(messages, handler(item, tools, replay))
    if payload.get("previous_response_id") is not None:
        _string(payload["previous_response_id"], "previous_response_id")
        if not any(message["role"] == "assistant" for message in messages):
            raise ValueError("previous_response_id requires explicit conversation history")
    if not messages:
        raise ValueError("Request must include input messages")
    _validate_tool_results(messages)
    return messages


def _tool_choice(choice, tools: _ToolCatalog) -> str | dict:
    if isinstance(choice, str) and choice in {"auto", "none", "required"}:
        if choice == "required" and not tools.declarations:
            raise ValueError("Required tool_choice needs declared tools")
        return choice
    if isinstance(choice, dict):
        kind = _string(choice.get("type"), "tool_choice type")
        if kind in {"function", "custom"}:
            return {"type": "function", "function": {"name": tools.resolve(choice, kind)}}
    raise ValueError("Unsupported tool_choice")


def _options(payload: dict, tools: _ToolCatalog) -> dict:
    options = {}
    if "max_output_tokens" in payload:
        value = payload["max_output_tokens"]
        if type(value) is not int or value <= 0:
            raise ValueError("max_output_tokens must be a positive integer")
        options["max_tokens"] = value
    for key, upper in (("temperature", 2), ("top_p", 1)):
        if key in payload:
            value = payload[key]
            if type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= upper:
                raise ValueError(f"{key} is outside its supported range")
            options[key] = value
    if "parallel_tool_calls" in payload:
        if not isinstance(payload["parallel_tool_calls"], bool):
            raise ValueError("parallel_tool_calls must be boolean")
        options["parallel_tool_calls"] = payload["parallel_tool_calls"]
    if "tool_choice" in payload:
        options["tool_choice"] = _tool_choice(payload["tool_choice"], tools)
    return options


def _anthropic_source(messages: list[dict]) -> list[dict]:
    source, system = [], []
    for message in deepcopy(messages):
        if message["role"] in {"system", "developer"}:
            content = message["content"]
            system.append(content if isinstance(content, str) else "\n".join(p["text"] for p in content))
        else:
            if message["role"] == "tool" and isinstance(message["content"], list):
                # The helper otherwise JSON-stringifies text-only tool result arrays.
                message["_anthropic_content_blocks"] = _convert_content_to_anthropic(message["content"])
            _append_message(source, message)
    if system:
        source.insert(0, {"role": "system", "content": "\n\n".join(system)})
    return source


def _restore_anthropic_replay(body: dict, source: list[dict]) -> None:
    assistants = (message for message in body["messages"] if message["role"] == "assistant")
    for original in source:
        if original["role"] != "assistant":
            continue
        converted = next(assistants)
        if original.get("anthropic_content_blocks"):
            # The encrypted carrier is authenticated to THIS route and model. The
            # general helper's unknown-relay signature stripping must not discard it.
            ordered, blocks = assistant_replay_carrier(original)
            if not ordered:
                raise ValueError("Anthropic replay content could not be preserved")
            converted["content"] = blocks


def _validate_replay_history(source: list[dict]) -> None:
    for message in source:
        blocks = message.get("anthropic_content_blocks")
        if not blocks:
            continue
        native_calls = [(b["id"], b["name"], b["input"]) for b in blocks if b["type"] == "tool_use"]
        visible_calls = [(c["id"], c["function"]["name"], json.loads(c["function"]["arguments"]))
                         for c in message.get("tool_calls", [])]
        content = message["content"]
        visible_text = content if isinstance(content, str) else "".join(p["text"] for p in content or [])
        native_text = "".join(b["text"] for b in blocks if b["type"] == "text")
        # Changing the authenticated turn can invalidate its thinking signatures;
        # never repair mismatched history by silently replacing either side.
        if native_calls != visible_calls or native_text != visible_text:
            raise ValueError("Anthropic replay does not match the visible assistant history")


def _anthropic_history_without_tools(source: list[dict]) -> bool:
    if not any(message.get("tool_calls") for message in source):
        return False
    for message in source:
        if message["role"] != "assistant":
            continue
        _, blocks = assistant_replay_carrier(message)
        thinking = [block for block in blocks if block.get("type") in {"thinking", "redacted_thinking"}]
        readable = _keep_valid_thinking(thinking, signature_dead=True)
        fallback = message.get("reasoning_content") or message.get("reasoning")
        if not readable and fallback:
            readable = [{"type": "text", "text": fallback}]
        if readable:
            message["content"] = _join_content(readable, message["content"])
        # Native local compaction declares no tools. Its request copy uses Hermes's
        # text projection; retaining the ordered carrier would override that text
        # with tool_use blocks, and their signatures cannot survive this projection.
        for key in ("anthropic_content_blocks", "reasoning_details", "reasoning_content", "reasoning"):
            message.pop(key, None)
    return True


def _anthropic_call_ids(source: list[dict]) -> dict[str, str]:
    originals = {}
    for message in source:
        for call in message.get("tool_calls", []):
            call_id = call["id"]
            sanitized = _sanitize_tool_id(call_id)
            if sanitized in originals and originals[sanitized] != call_id:
                raise ValueError("Anthropic tool call_id collision")
            originals[sanitized] = call_id
    return originals


def _restore_call_ids(body: dict, originals: dict[str, str]) -> None:
    for message in body["messages"]:
        if not isinstance(message["content"], list):
            continue
        for block in message["content"]:
            key = {"tool_use": "id", "tool_result": "tool_use_id"}.get(block["type"])
            if key and block[key] in originals:
                block[key] = originals[block[key]]


def _anthropic_tools(tools: _ToolCatalog) -> list[dict]:
    result = []
    for tool in tools.declarations:
        function = tool["function"]
        native = {"name": function["name"], "input_schema": deepcopy(function["parameters"])}
        for field in ("description", "strict"):
            if field in function:
                native[field] = function[field]
        result.append(native)
    return result


def _anthropic_choice(options: dict) -> dict:
    choice = options.get("tool_choice", "auto")
    if isinstance(choice, dict):
        native = {"type": "tool", "name": choice["function"]["name"]}
    else:
        native = {"type": {"auto": "auto", "required": "any", "none": "none"}[choice]}
    if "parallel_tool_calls" in options and native["type"] != "none":
        native["disable_parallel_tool_use"] = not options["parallel_tool_calls"]
    return native


def _anthropic_body(body: dict, tools: _ToolCatalog, base_url: str) -> dict:
    source = _anthropic_source(body["messages"])
    _validate_replay_history(source)
    originals = _anthropic_call_ids(source)
    history_as_text = not tools.declarations and _anthropic_history_without_tools(source)
    result = build_anthropic_kwargs(
        body["model"], source, tools.declarations, max_tokens=body.get("max_tokens"),
        reasoning_config=None, preserve_dots=True, base_url=base_url,
    )
    # This bridge has no authority to normalize a catalog id or change a schema.
    result["model"] = body["model"]
    result["stream"] = True
    if tools.declarations:
        result["tools"] = _anthropic_tools(tools)
        result["tool_choice"] = _anthropic_choice(body)
    for field in ("temperature", "top_p"):
        if field in body:
            result[field] = body[field]
    if not history_as_text:
        _restore_anthropic_replay(result, source)
    _restore_call_ids(result, originals)
    return result


def prepare_request(payload: dict, api_mode: str, *, base_url: str, replay) -> PreparedRequest:
    """Convert explicit history without changing the selected route or executing tools.

    Request-level Responses reasoning/text/include controls are intentionally not
    forwarded. In particular, reasoning.effort is not a portable provider setting;
    only history's captured reasoning is replayed. Tool-free Anthropic compaction
    projects readable reasoning and tool history into assistant text on a copy;
    requests declaring tools retain signed replay. The relay should translate
    ValueError into a fixed local 400 response rather than expose dependency errors.
    """
    _object(payload, "request")
    if api_mode not in {"chat_completions", "anthropic_messages"}:
        raise ValueError("Unsupported bridge API mode")
    model = _string(payload.get("model"), "model")
    tools = _catalog(payload.get("tools", []))
    body = {"model": model, "messages": _messages(payload, tools, replay), "stream": True,
            **_options(payload, tools)}
    if tools.declarations:
        body["tools"] = tools.declarations
    if api_mode == "anthropic_messages":
        body = _anthropic_body(body, tools, base_url)
        path = "/messages" if base_url.rstrip("/").endswith("/v1") else "/v1/messages"
    else:
        for message in body["messages"]:
            message.pop("anthropic_content_blocks", None)
        path = "/chat/completions"
    return PreparedRequest(path, body, tools.identities)
