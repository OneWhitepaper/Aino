"""Recoverable managed failures without replaying a paid turn or tool effects."""

from agent.auxiliary_billing_scope import ManagedCredential, managed_operation_dispatched

_DEVICE_REJECTION_CODES = frozenset({
    'API_KEY_DISABLED', 'INVALID_API_KEY', 'USER_INACTIVE', 'DESKTOP_DEVICE_KEY_REVOKED',
})

_CODES = {
    "DESKTOP_OPERATION_UNKNOWN": "managed_operation_unknown",
    "IDEMPOTENCY_KEY_CONFLICT": "managed_operation_conflict",
    "INVALID_DESKTOP_OPERATION": "managed_operation_invalid",
    "managed_operation_unknown": "managed_operation_unknown",
    "DESKTOP_CREDENTIAL_EXPIRED": "managed_credential_expired",
    "DESKTOP_CREDENTIAL_REVOKED": "managed_credential_revoked",
    "DESKTOP_CREDENTIAL_SCOPE": "managed_credential_revoked",
    "DESKTOP_AUTH_UNAVAILABLE": "managed_auth_unavailable",
    "DESKTOP_BILLING_UNAVAILABLE": "managed_billing_unavailable",
    "SUBSCRIPTION_EXPIRED": "managed_subscription_expired",
    "DESKTOP_MODEL_NOT_ALLOWED": "managed_model_access_denied",
    "DESKTOP_QUOTA_EXHAUSTED": "managed_balance_unavailable",
    "INSUFFICIENT_BALANCE": "managed_balance_unavailable",
    "SUBSCRIPTION_NOT_FOUND": "managed_balance_unavailable",
    "SUBSCRIPTION_INVALID": "managed_balance_unavailable",
    "USAGE_LIMIT_EXCEEDED": "managed_balance_unavailable",
    "API_KEY_QUOTA_EXHAUSTED": "managed_balance_unavailable",
    "insufficient_quota": "managed_balance_unavailable",
    "awaiting_managed_credentials": "managed_credential_expired",
    "managed_model_identity_mismatch": "managed_credential_revoked",
    "managed_billing_scope_mismatch": "managed_credential_revoked",
    "managed_credential_destination_mismatch": "managed_credential_revoked",
}
_MESSAGES = {
    "managed_operation_unknown": "The Aino request outcome is unknown. It may have executed. Your conversation is preserved; automatic retry is stopped.",
    "managed_operation_conflict": "Aino rejected a changed request using an existing operation identity. Your conversation is preserved.",
    "managed_operation_invalid": "Aino rejected the request operation identity. Your conversation is preserved.",
    "managed_credential_expired": "Aino model authorization expired. Reconnect the platform model before sending again.",
    "managed_credential_revoked": "Aino model authorization was revoked. Sign in and select the model again.",
    "managed_credential_rejected": "Aino device authorization was rejected. Check this device's authorization in your account.",
    "managed_auth_unavailable": "Aino authorization is temporarily unavailable. Your conversation is preserved.",
    "managed_upstream_auth_failed": "The Aino model channel rejected authentication. Select another model or retry later.",
    "managed_balance_unavailable": "Aino balance or subscription quota is unavailable. Check your account or select another model.",
    "managed_billing_unavailable": "The Aino plan status is unavailable. Check the subscription and expiry in My Account, or select an available model.",
    "managed_subscription_expired": "The Aino subscription has expired. Renew it in My Account, or select an available model.",
    "managed_model_access_denied": "Your current Aino plan or account cannot use this model. Check My Account, or select an available model.",
}


class ManagedOperationUnknown(RuntimeError):
    """An accepted request may have executed; no automatic replay is permitted."""

    def __init__(self):
        super().__init__(_MESSAGES["managed_operation_unknown"])


def managed_operation_error(error, *, managed=False):
    """Distinguish proven pre-send failures from uncertain post-dispatch outcomes."""
    # Explicit cancellation is turn control, even after dispatch. Preserve it for
    # the interrupted-turn handler instead of replacing it with a provider failure.
    if not managed or isinstance(error, InterruptedError):
        return None
    import httpx
    from agent.errors import EmptyStreamError

    if isinstance(error, ManagedOperationUnknown):
        return error
    code = _error_code(error)
    if code in _CODES or code in _DEVICE_REJECTION_CODES:
        return None
    cause = error
    ambiguous = False
    for _ in range(8):
        if cause is None:
            break
        if str(cause) in _CODES or _error_code(cause) in _CODES.keys() | _DEVICE_REJECTION_CODES:
            return None
        if isinstance(cause, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
            return None
        ambiguous |= isinstance(cause, (httpx.TransportError, TimeoutError, ConnectionError, EmptyStreamError))
        ambiguous |= type(cause).__name__ in {"APIConnectionError", "APITimeoutError", "StreamLifetimeExceeded"}
        cause = getattr(cause, "__cause__", None)
    status = getattr(error, "status_code", None)
    if status in (401, 402, 403):
        return None
    if ambiguous or status == 408 or (isinstance(status, int) and status >= 500) or managed_operation_dispatched():
        unknown = ManagedOperationUnknown()
        unknown.__cause__ = error
        return unknown
    return None


def raise_managed_operation_error(error, *, managed=False):
    if unknown := managed_operation_error(error, managed=managed):
        if unknown is error:
            raise unknown
        raise unknown from error


def managed_terminal_error(agent, error):
    managed = isinstance(getattr(agent, "api_key", None), ManagedCredential)
    if unknown := managed_operation_error(error, managed=managed):
        return unknown
    return error if managed_failure_result(agent, error, [], 0) is not None else None


def require_managed_stream_completion(finish_reason):
    if not finish_reason and managed_operation_dispatched():
        raise ManagedOperationUnknown()


def raise_managed_agent_operation_error(agent, error):
    raise_managed_operation_error(error, managed=isinstance(getattr(agent, "api_key", None), ManagedCredential))


def _request_credential_identity(error):
    for _ in range(4):
        if error is None:
            return None
        try:
            request = getattr(error, 'request', None)
        except RuntimeError:
            # HTTPX request exceptions raised before binding a request expose a
            # property that raises instead of returning None.
            request = None
        extensions = getattr(request, 'extensions', {})
        version = extensions.get('aino_managed_credential_version')
        if type(version) is int and version > 0:
            return extensions.get('aino_managed_owner_user_id'), version
        error = getattr(error, '__cause__', None)
    return None


def _error_code(error):
    body = getattr(error, 'body', None)
    detail = body.get('error', body) if isinstance(body, dict) else {}
    return detail.get('code') if isinstance(detail, dict) else None


def managed_credential_rejection(error):
    """Only an explicit device rejection with its actual request identity can suspend reuse."""
    if _error_code(error) not in _DEVICE_REJECTION_CODES:
        return None
    identity = _request_credential_identity(error)
    if identity is not None and isinstance(identity[0], str) and identity[0]:
        return identity
    return None


def managed_failure_result(agent, error, messages, api_call_count):
    if not isinstance(error, ManagedOperationUnknown) and not isinstance(getattr(agent, "api_key", None), ManagedCredential):
        return None
    code = _error_code(error)
    reason = _CODES.get(code)
    if isinstance(error, ManagedOperationUnknown):
        reason = "managed_operation_unknown"
    if code in _DEVICE_REJECTION_CODES:
        reason = 'managed_credential_rejected'
    cause = error
    # SDKs may wrap the local credential failure in an APIConnectionError.
    for _ in range(4):
        if cause is None or reason:
            break
        reason = _CODES.get(str(cause))
        cause = getattr(cause, '__cause__', None)
    if reason is None:
        reason = {401: "managed_upstream_auth_failed", 403: "managed_upstream_auth_failed",
                  402: "managed_balance_unavailable"}.get(getattr(error, "status_code", None))
    if reason is None:
        if managed_operation_error(error, managed=True) is not None:
            reason = "managed_operation_unknown"
    if reason is None:
        return None
    message = _MESSAGES[reason]
    result = {"final_response": message, "error": message, "messages": messages,
              "api_calls": api_call_count, "failed": True, "completed": False,
              "failure_reason": reason, "failure_retryable": False}
    if reason == "managed_operation_unknown":
        from agent.agent_runtime_helpers import strip_think_blocks
        partial = strip_think_blocks(agent, getattr(agent, "_current_streamed_assistant_text", "") or "").strip()
        if partial:
            result.update(final_response=partial, partial=True)
    identity = _request_credential_identity(error)
    if identity is not None:
        result['managed_credential_version'] = identity[1]
    return result
