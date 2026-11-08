"""A rejected device identity asks main to confirm status without replaying a turn."""

from types import SimpleNamespace

import httpx
from openai import AuthenticationError, PermissionDeniedError
import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
from agent.error_surface import build_error_surface_from_result
from agent.managed_inference_errors import managed_credential_rejection, managed_failure_result


@pytest.mark.parametrize('code', ['API_KEY_DISABLED', 'INVALID_API_KEY', 'USER_INACTIVE'])
def test_device_auth_rejection_is_distinct_from_upstream_and_confirmed_revocation(code):
    key = ManagedCredential(lambda: 'secret', 'user', 'session', 'model', 'https://aino.invalid/v1',
                            'chat_completions', False, model_id='catalog')
    error = SimpleNamespace(body={'error': {'code': code}}, status_code=401, __cause__=None)
    history = [{'role': 'user', 'content': 'original'}]
    result = managed_failure_result(SimpleNamespace(api_key=key), error, history, 1)
    assert result['failure_reason'] == 'managed_credential_rejected'
    assert result['failure_retryable'] is False
    assert result['messages'] is history
    assert 'secret' not in str(result)


def test_ordinary_lease_upstream_failure_keeps_its_original_recovery_contract():
    key = ManagedCredential(lambda: 'lease', 'user', 'session', 'model', 'https://aino.invalid/v1',
                            'chat_completions', False)
    error = SimpleNamespace(body={'error': {'code': 'upstream_auth_failed'}}, status_code=401, __cause__=None)
    result = managed_failure_result(SimpleNamespace(api_key=key), error, [], 1)
    assert result['failure_reason'] == 'managed_upstream_auth_failed'


def test_rejection_identifies_the_actual_request_version_after_binding_rotates():
    identity = ['old-secret', 'catalog-option', 7]
    key = ManagedCredential(lambda: identity[0], 'user', 'session', 'model', 'https://aino.invalid/v1',
                            'chat_completions', False,
                            scope=BillingScope('aino', 'user', 'session', 'turn', 'chat'),
                            get_request_identity=lambda: tuple(identity))
    request = httpx.Request('POST', 'https://aino.invalid/v1/chat/completions', json={'model': 'model'})
    key.prepare_request(request)
    identity[:] = ['new-secret', 'catalog-option', 8]
    response = httpx.Response(401, request=request)
    error = AuthenticationError('device rejected', response=response, body={'error': {'code': 'INVALID_API_KEY'}})
    result = managed_failure_result(SimpleNamespace(api_key=key), error, [], 1)
    assert result['managed_credential_version'] == 7
    assert managed_credential_rejection(error) == ('user', 7)
    surface = build_error_surface_from_result(result, provider='aino', model='model')
    assert surface['managed_credential_version'] == 7
    assert 'secret' not in str(surface)
    next_request = httpx.Request('POST', request.url, json={'model': 'model'})
    key.for_task('compression').prepare_request(next_request)
    assert next_request.extensions['aino_managed_credential_version'] == 8
    assert next_request.headers['Authorization'] == 'Bearer new-secret'


def test_unversioned_lease_failure_cannot_reject_a_current_device_key():
    key = ManagedCredential(lambda: 'lease', 'user', 'session', 'model', 'https://aino.invalid/v1',
                            'chat_completions', False)
    error = SimpleNamespace(body={'error': {'code': 'INVALID_API_KEY'}}, status_code=401, __cause__=None)
    result = managed_failure_result(SimpleNamespace(api_key=key), error, [], 1)
    assert 'managed_credential_version' not in result
    assert 'managed_credential_version' not in build_error_surface_from_result(result)


@pytest.mark.parametrize(('code', 'reason'), [
    ('DESKTOP_BILLING_UNAVAILABLE', 'managed_billing_unavailable'),
    ('SUBSCRIPTION_EXPIRED', 'managed_subscription_expired'),
    ('DESKTOP_MODEL_NOT_ALLOWED', 'managed_model_access_denied'),
    ('DESKTOP_QUOTA_EXHAUSTED', 'managed_balance_unavailable'),
])
@pytest.mark.parametrize('nested', [False, True])
def test_account_entitlement_refusal_is_not_an_upstream_auth_failure(code, reason, nested):
    key = ManagedCredential(lambda: 'secret', 'user', 'session', 'model', 'https://aino.invalid/v1',
                            'chat_completions', False, model_id='catalog')
    request = httpx.Request('POST', key.base_url + '/chat/completions')
    body = {'code': code, 'message': 'selected platform model is not available to this account'}
    error = PermissionDeniedError('private upstream detail', response=httpx.Response(403, request=request),
                                  body={'error': body} if nested else body)
    history = [{'role': 'user', 'content': 'original'}]
    result = managed_failure_result(SimpleNamespace(api_key=key), error, history, 1)
    assert result['failure_reason'] == reason
    assert result['failure_retryable'] is False
    assert result['messages'] is history
    assert managed_credential_rejection(error) is None
    surface = build_error_surface_from_result(result, provider='aino', model='model')
    assert surface['code'] == reason and surface['layer'] == 'billing'
    assert surface['retryable'] is False
    assert 'secret' not in str(result) and 'private upstream detail' not in str(result)
