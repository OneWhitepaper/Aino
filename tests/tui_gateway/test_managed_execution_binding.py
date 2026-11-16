"""A detached viewer cannot revoke an admitted turn or authorize a future one."""

from dataclasses import replace

import pytest

from tests.tui_gateway.test_managed_device_key import device_payload
from tui_gateway.managed_model_runtime import ManagedModelRegistry
from tui_gateway.methods_managed_model import _binding


@pytest.fixture
def execution_binding(monkeypatch):
    import tui_gateway.managed_model_runtime as runtime

    registry = ManagedModelRegistry()
    monkeypatch.setattr(runtime, '_managed_model_registry', registry)
    viewer, controller = object(), object()
    interrupted = []
    session = {'transport': viewer, '_interrupt_managed': lambda generation=None, revision=None: interrupted.append(generation),
               'managed_model_params': {'model_id': device_payload()['model_id']}}
    original = _binding(device_payload(), 'sid')
    ticket = registry.issue('sid', session, viewer, original.owner, original.model_id)
    revision = registry.claim('sid', session, controller, ticket, original.owner, original.model_id)
    binding = replace(original, binding_revision=revision)
    registry.bind(binding, session, controller)
    try:
        yield registry, session, viewer, controller, binding, interrupted
    finally:
        registry.clear_session('sid')


@pytest.mark.parametrize('disconnected', ['viewer', 'controller'])
def test_disconnect_preserves_only_the_admitted_execution(execution_binding, disconnected):
    registry, session, viewer, controller, binding, interrupted = execution_binding
    registry.retain_execution('sid', session, 7)
    registry.disconnect(viewer if disconnected == 'viewer' else controller)
    assert interrupted == []
    assert registry.get('sid', session) is None
    assert not registry.reusable('sid', session, controller, binding.owner, binding.model_id,
                                 binding.binding_revision, binding.credential_version)
    assert registry.get_for_execution('sid', session, 7) is binding
    assert registry.get_for_execution('sid', session, 8) is None
    registry.release_execution('sid', 6)
    assert registry.get_for_execution('sid', session, 7) is binding
    registry.release_execution('sid', 7)
    assert registry.get_for_execution('sid', session, 7) is None


@pytest.mark.parametrize('revoke', ['clear', 'expire', 'clear_session'])
def test_detached_execution_still_obeys_explicit_revocation(execution_binding, revoke):
    registry, session, viewer, controller, binding, interrupted = execution_binding
    registry.retain_execution('sid', session, 7)
    registry.disconnect(viewer)
    if revoke == 'clear':
        assert registry.clear('sid', binding.binding_revision, controller)
    elif revoke == 'expire':
        registry._expire(('sid', 'chat'), registry._active[('sid', 'chat')])
    else:
        registry.clear_session('sid')
    assert registry.get_for_execution('sid', session, 7) is None
    if revoke != 'clear_session':
        assert interrupted == [7]
