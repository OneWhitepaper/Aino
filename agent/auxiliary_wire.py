"""Message hygiene at the resolved auxiliary client boundary."""

from types import SimpleNamespace
from typing import Any

from openai import AsyncOpenAI, OpenAI

from agent.transports.chat_completions import ChatCompletionsTransport


def prepare_chat_messages(client, kwargs: dict) -> dict:
    """Sanitize actual Chat Completions SDK requests, not native adapter replay.

    Auxiliary and MoA callers can retain a prepared request before the virtual
    transport sanitizes its copy. The resolved SDK client identifies the wire;
    native Messages/Responses adapters must retain their reasoning sidecars.
    """
    if not isinstance(client, (OpenAI, AsyncOpenAI)) or "messages" not in kwargs:
        return kwargs
    from agent.reasoning_carriers import shape_wire_carriers

    base_url = str(getattr(client, "base_url", "") or "")
    messages = ChatCompletionsTransport().convert_messages(
        shape_wire_carriers(kwargs["messages"], model=kwargs.get("model"), base_url=base_url),
        model=kwargs.get("model"), base_url=base_url,
    )
    return {**kwargs, "messages": messages}


def _unwrap_data_envelope(response: Any, task: str | None = None) -> Any:
    """Unwrap gateway envelopes like {"data": {<chat completion>}, "success": true}.

    Some OpenAI-compatible gateways (e.g. api.cline.bot) wrap non-streaming
    JSON bodies in a data/success envelope.  The SDK leniently parses this
    into a ChatCompletion with choices=None and keeps the envelope keys as
    extra fields, so the real completion is reachable at ``response.data``.
    Error envelopes ({"success": false, "data": {"error": ...}}) raise the
    provider's actual error instead of a generic invalid-response error.
    """
    from agent.auxiliary_client import _field

    if _field(response, "choices"):
        return response
    data = _field(response, "data")
    if not isinstance(data, dict):
        return response
    if _field(response, "success") is False:
        err = data.get("error") or data
        msg = err.get("message") if isinstance(err, dict) else None
        raise RuntimeError(
            f"Auxiliary {task or 'call'}: provider returned error envelope: "
            f"{msg or err}"
        )
    if not data.get("choices"):
        return response
    try:
        return type(response).model_validate(data)
    except (AttributeError, TypeError, ValueError):
        # No model_validate (SimpleNamespace) or the inner payload fails
        # strict validation (pydantic ValidationError is a ValueError).
        pass
    choices = []
    for ch in data["choices"]:
        msg = ch.get("message") if isinstance(ch, dict) else None
        if isinstance(msg, dict):
            choices.append(SimpleNamespace(
                message=SimpleNamespace(**msg),
                finish_reason=ch.get("finish_reason") or "stop",
            ))
    if not choices:
        return response
    return SimpleNamespace(
        id=data.get("id", ""),
        model=data.get("model", ""),
        object=data.get("object", "chat.completion"),
        choices=choices,
        usage=data.get("usage"),
    )
