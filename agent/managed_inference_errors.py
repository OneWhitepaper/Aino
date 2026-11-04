"""Recoverable managed failures without replaying a paid turn or tool effects."""

from agent.auxiliary_billing_scope import ManagedCredential

_DEVICE_REJECTION_CODES = frozenset({
    'API_KEY_DISABLED', 'INVALID_API_KEY', 'USER_INACTIVE', 'DESKTOP_DEVICE_KEY_REVOKED',
})

_CODES = {
    "DESKTOP_CREDENTIAL_EXPIRED": "managed_credential_expired",
    "DESKTOP_CREDENTIAL_REVOKED": "managed_credential_revoked",
    "DESKTOP_CREDENTIAL_SCOPE": "managed_credential_revoked",
    "DESKTOP_AUTH_UNAVAILABLE": "managed_auth_unavailable",
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
    "managed_credential_expired": "Aino model authorization expired. Reconnect the platform model before sending again.",
    "managed_credential_revoked": "Aino model authorization was revoked. Sign in and select the model again.",
    "managed_credential_rejected": "Aino device authorization was rejected. Check this device's authorization in your account.",
    "managed_auth_unavailable": "Aino authorization is temporarily unavailable. Your conversation is preserved.",
    "managed_upstream_auth_failed": "The Aino model channel rejected authentication. Select another model or retry later.",
    "managed_balance_unavailable": "Aino balance or subscription quota is unavailable. Check your account or select another model.",
}


def _request_credential_identity(error):
    for _ in range(4):
        if error is None:
            return None
        request = getattr(error, 'request', None)
        extensions = getattr(request, 'extensions', {})
        version = extensions.get('aino_managed_credential_version')
        if type(version) is int and version > 0:
            return extensions.get('aino_managed_owner_user_id'), version
        error = error.__cause__
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
    if not isinstance(getattr(agent, "api_key", None), ManagedCredential):
        return None
    code = _error_code(error)
    reason = _CODES.get(code)
    if code in _DEVICE_REJECTION_CODES:
        reason = 'managed_credential_rejected'
    cause = error
    # SDKs may wrap the local credential failure in an APIConnectionError.
    for _ in range(4):
        if cause is None or reason:
            break
        reason = _CODES.get(str(cause))
        cause = cause.__cause__
    if reason is None:
        reason = {401: "managed_upstream_auth_failed", 403: "managed_upstream_auth_failed",
                  402: "managed_balance_unavailable"}.get(getattr(error, "status_code", None))
    if reason is None:
        return None
    message = _MESSAGES[reason]
    result = {"final_response": message, "error": message, "messages": messages,
              "api_calls": api_call_count, "failed": True, "completed": False,
              "failure_reason": reason, "failure_retryable": False}
    identity = _request_credential_identity(error)
    if identity is not None:
        result['managed_credential_version'] = identity[1]
    return result
