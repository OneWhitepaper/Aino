"""Private hosted errors retain bounded domain reasons without parsing arbitrary messages."""
import asyncio

import pytest


@pytest.fixture
def owner_error_server(hosted_owner, tmp_path):
    from gateway.control_socket import GatewayControlServer
    authority, loop, _, _ = hosted_owner
    home = tmp_path / 'error-owner'
    home.mkdir(mode=0o700)
    descriptor = {'runtime_protocol': 1, 'state': 'ready', 'instance_id': 'errors',
                  'authority_epoch': authority.epoch,
                  'served_profiles': [{'home': str(home), 'profile_id': str(home)}],
                  'capabilities': ['session-authority-v1'], 'api_origin': 'http://127.0.0.1:1',
                  'supervisor': 'none'}
    server = GatewayControlServer(home, verb_handlers={'identify': lambda: descriptor})
    assert asyncio.run_coroutine_threadsafe(server.start(), loop).result()
    try:
        yield home, server
    finally:
        asyncio.run_coroutine_threadsafe(server.stop(), loop).result()


@pytest.mark.parametrize('reason', [
    'storage_unavailable', 'awaiting_managed_credentials', 'managed_binding_forbidden',
    'managed_binding_busy', 'managed_binding_stale', 'managed_binding_expired',
    'managed_binding_invalid', 'managed_model_identity_mismatch', 'managed_model_protocol_unsupported',
    'managed_model_switch_failed', 'session_busy', 'not_found', 'revision_conflict',
    'runtime_coordination_required', 'stale_epoch', 'queue_full', 'session_idle', 'admission_started',
    'permission_denied', 'profile_mismatch', 'invalid_params', 'unknown_execution',
    'stale_generation', 'admission_conflict', 'request_too_large', 'unsupported_operation',
])
def test_hosted_owner_preserves_exact_runtime_domain_reason(owner_error_server, reason):
    from gateway.session_hosted_transport import owner_request
    from hermes_state_runtime import RuntimeStoreError
    home, server = owner_error_server

    def refuse(params, peer):
        raise RuntimeStoreError(reason, detail='private diagnostic stays at the owner')
    server.private_handlers['hosted-error'] = refuse
    with pytest.raises(RuntimeStoreError) as caught:
        owner_request(home, 'hosted-error', {})
    assert caught.value.reason == reason
    assert caught.value.detail is None


def test_hosted_owner_preserves_exact_registry_error(owner_error_server):
    from gateway.session_hosted_transport import owner_request
    from hermes_state_runtime import RuntimeStoreError
    from tui_gateway.managed_model_runtime import ManagedBindingError
    home, server = owner_error_server

    def refuse(params, peer):
        raise ManagedBindingError('managed_binding_forbidden')
    server.private_handlers['hosted-error'] = refuse
    with pytest.raises(RuntimeStoreError) as caught:
        owner_request(home, 'hosted-error', {})
    assert caught.value.reason == 'managed_binding_forbidden'


@pytest.mark.parametrize('message', [
    'private diagnostic: permission_denied', 'storage_unavailable: permission_denied',
    'future_domain_reason', 'storage_unavailable\nprivate diagnostic',
])
def test_hosted_owner_unknown_error_cannot_impersonate_a_known_suffix(owner_error_server, message):
    from gateway.session_hosted_transport import owner_request
    from hermes_state_runtime import RuntimeStoreError
    home, server = owner_error_server

    def refuse(params, peer):
        raise RuntimeStoreError(message)
    server.private_handlers['hosted-error'] = refuse
    with pytest.raises(RuntimeStoreError) as caught:
        owner_request(home, 'hosted-error', {})
    assert caught.value.reason == 'runtime_draining'
    assert str(caught.value) == 'runtime_draining'
