"""Typed wire-content sidecars and their backwards-compatible SQLite TEXT encoding."""

from __future__ import annotations

import json
from typing import Any, Mapping

ApiContent = str | list[dict[str, Any]]
API_CONTENT_JSON_PREFIX = "\x1eaino-api-content:v1:"


def api_content_value(value: Any) -> ApiContent | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and all(isinstance(part, dict) for part in value):
        return value
    return None


def effective_message_content(message: Mapping[str, Any]) -> Any:
    sidecar = api_content_value(message.get("api_content"))
    return sidecar if sidecar and message.get("role") in ("user", "assistant") else message.get("content")


def encode_api_content(value: Any) -> str | None:
    value = api_content_value(value)
    if value is None:
        return None
    if isinstance(value, str) and not value.startswith(API_CONTENT_JSON_PREFIX):
        return value
    # Escape reserved-prefix strings as well, so user text never becomes a parts array.
    return API_CONTENT_JSON_PREFIX + json.dumps({"content": value}, separators=(",", ":"))


def decode_api_content(value: Any) -> ApiContent | None:
    if not isinstance(value, str):
        return None
    if value.startswith(API_CONTENT_JSON_PREFIX):
        try:
            envelope = json.loads(value[len(API_CONTENT_JSON_PREFIX):])
        except (TypeError, ValueError):
            return value
        if isinstance(envelope, dict) and set(envelope) == {"content"}:
            decoded = api_content_value(envelope["content"])
            if decoded is not None:
                return decoded
    return value
