"""A running room member survives viewer handoff but still honors credential revocation."""

from contextlib import contextmanager
from types import SimpleNamespace

from tests.gateway.test_hosted_group_members import _gateway, _members
from tests.gateway.test_session_group_models import _bind, _connection, _prepare, _request


@contextmanager
def _running_group(tmp_path, monkeypatch):
    from gateway.session_platform_model import binding_key, managed_state
    from tui_gateway.managed_model_runtime import get_registry

    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        source = runner.session_authority
        target = runner.session_authorities.for_home(homes['helper'])
        viewer, native = _connection(source), _connection(source)
        assert 'result' in _request(call, viewer, 'groups.create', room_id='room', name='Room',
                                    members=_members('default', 'helper'))
        prepared = _prepare(call, viewer)['result']
        _bind(call, native, prepared)
        sid, generation = prepared['session_id'], 1
        state, key = managed_state(target, sid), binding_key(target, sid)
        monkeypatch.setattr(target, '_handle', lambda _ref: SimpleNamespace(execution_state='running'))
        target.executing[sid] = generation
        registry = get_registry()
        registry.retain_execution(key, state, generation)
        try:
            yield runner, source, target, viewer, native, call, sid, key, state, generation
        finally:
            registry.release_execution(key, generation)
            target.executing.pop(sid, None)
            registry.clear_session(key)
            call(viewer.close())
            call(native.close())


def test_group_viewer_reconnect_keeps_the_admitted_runtime_through_ticket_and_bind(tmp_path, monkeypatch):
    from gateway.run_turn_prepare import _resolve_policy_agent_runtime
    from gateway.session_authorities import owner_scope
    from gateway.session_policy import policy_for_source
    from tui_gateway.managed_model_execution import managed_execution_scope
    from tui_gateway.managed_model_runtime import get_registry

    with _running_group(tmp_path, monkeypatch) as values:
        runner, source, target, viewer, native, call, sid, key, state, generation = values
        fresh_viewer, fresh_native = _connection(source), _connection(source)
        try:
            with owner_scope(target), managed_execution_scope(key, generation):
                live = target.sessions[sid]
                _, runtime = _resolve_policy_agent_runtime(
                    runner, policy_for_source(runner, live.source), source=live.source)
                assert runtime['api_key']() == 'group-only-secret'
                prepared = _prepare(call, fresh_viewer)
                assert 'result' in prepared, prepared
                call(viewer.close())
                assert runtime['api_key']() == 'group-only-secret'
                assert get_registry().get(key, state) is None, 'a handoff cannot admit a new turn yet'
                _bind(call, fresh_native, prepared['result'])
                call(native.close())
                assert runtime['api_key']() == 'group-only-secret'
                assert get_registry().get(key, state) is not None
        finally:
            call(fresh_viewer.close())
            call(fresh_native.close())


def test_group_reprepare_keeps_generation_fenced_expiry_interrupts_working(tmp_path, monkeypatch):
    from tui_gateway.managed_model_runtime import get_registry

    with _running_group(tmp_path, monkeypatch) as values:
        _, _, target, viewer, _, call, _, key, _, _ = values
        interrupted = []
        monkeypatch.setattr(target, 'agent', lambda _ref: SimpleNamespace(
            interrupt=lambda **kwargs: interrupted.append(kwargs)))
        assert 'result' in _prepare(call, viewer)
        registry = get_registry()
        active = registry._active[(key, 'chat')]
        callback_error = None
        try:
            registry._expire((key, 'chat'), active)
        except TypeError as exc:
            callback_error = str(exc)
        assert callback_error is None, f'credential expiry callback failed: {callback_error}'
        assert len(interrupted) == 1, 'a live room member must stop when its authority expires'
        assert registry.get(key) is None
