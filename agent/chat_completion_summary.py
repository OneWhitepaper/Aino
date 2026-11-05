"""Iteration-summary dispatch and validation using the turn's request identity."""

import logging

from agent.auxiliary_billing_scope import ManagedCredential, managed_operation_scope
from agent.managed_inference_errors import ManagedOperationUnknown, raise_managed_operation_error
from agent.transports.chat_completions import is_router_timeout_shim

logger = logging.getLogger("agent.chat_completion_helpers")


def managed_summary_call(agent, api_request_id: str, request, callback, *, retry_count: int):
    from agent import relay_llm
    with managed_operation_scope(api_request_id):
        try:
            return relay_llm.execute_current(
                request, callback,
                name=str(getattr(agent, "provider", "") or "provider"), model_name=str(getattr(agent, "model", "") or ""),
                metadata={"api_mode": str(getattr(agent, "api_mode", "") or "chat_completions"),
                    "api_request_id": api_request_id, "call_role": "iteration_summary", "retry_count": retry_count},
                defer_logical_completion=True,
            )
        except Exception as error:
            raise_managed_operation_error(error, managed=isinstance(getattr(agent, "api_key", None), ManagedCredential))
            raise


def summary_text(agent, response, **normalize_kwargs) -> str:
    if is_router_timeout_shim(response):
        # Router failure in a 200 envelope (#68396): an empty summary takes the retry slot.
        logger.warning("Iteration summary returned a router timeout shim; retrying")
        if isinstance(getattr(agent, "api_key", None), ManagedCredential):
            raise ManagedOperationUnknown()
        return ""
    normalized = agent._get_transport().normalize_response(response, **normalize_kwargs)
    if normalized.tool_calls:
        # No summary path executes tool calls; log so a tool-only response that falls into the
        # empty-summary retry is diagnosable.
        logger.warning("Iteration summary emitted tool calls; discarding them")
    content = (normalized.content or "").strip()
    if not content and isinstance(getattr(agent, "api_key", None), ManagedCredential):
        raise ManagedOperationUnknown()
    return content


