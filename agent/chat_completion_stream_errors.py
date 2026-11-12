"""Streaming compatibility and transport error shapes."""

import sys

_SSE_CONN_PHRASES = ("connection lost", "connection reset", "connection closed", "connection terminated",
    "network error", "network connection", "terminated", "peer closed", "broken pipe",
    "upstream connect error")


def rejects_stream_options(exc: BaseException) -> bool:
    """A 400/422 whose body names ``stream_options`` as an unknown/extra field: strict
    OpenAI-compatible endpoints (Azure AI Foundry MaaS, Pydantic ``extra_forbidden``) reject
    the usage extension outright (#9705). Distinct from "stream not supported", which turns
    streaming off on this route."""
    if getattr(exc, "status_code", None) not in (400, 422):
        return False
    body = f"{getattr(exc, 'body', '') or ''} {exc}".lower()
    return "stream_options" in body and any(
        k in body for k in ("extra", "not supported", "unrecognized", "unexpected", "unknown"))


def anthropic_connection_error_types() -> tuple:
    # An Anthropic error instance implies the SDK is already imported; never import
    # (or lazy-install) it from inside an error handler.
    anthropic = sys.modules.get("anthropic")
    return (anthropic.APIConnectionError,) if anthropic is not None else ()


def is_sse_connection_error(exc: BaseException) -> bool:
    from openai import APIError as _APIError
    if not isinstance(exc, _APIError) or getattr(exc, "status_code", None):
        return False
    err_lower = str(exc).lower()
    return any(phrase in err_lower for phrase in _SSE_CONN_PHRASES)


