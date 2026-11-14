"""Adding or disabling a messaging platform never replaces the shared chat owner."""
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.run_messaging_connect import connect_platform
from hermes_constants import get_hermes_home


@pytest.fixture
def runner():
    from gateway.run_adapters import GatewayAdapterLifecycleMixin
    from gateway.run_profile_reconcile import GatewayProfileReconcileMixin

    class Runner(GatewayAdapterLifecycleMixin, GatewayProfileReconcileMixin):
        pass

    home = get_hermes_home()
    platform = Platform("weixin")
    saved = PlatformConfig(enabled=True, token="new-token", extra={"account_id": "account"})
    new = SimpleNamespace(config=saved, _active_sessions={}, is_connected=True, fatal_error_retryable=True)
    r = Runner()
    r._running, r._primary_profile_name = True, "default"
    r._served_profile_homes, r._profile_adapters = {}, {}
    r._failed_platforms = {}
    r.adapters = {Platform.LOCAL: object()}
    r.config = GatewayConfig(platforms={})
    r.delivery_router = SimpleNamespace(adapters=r.adapters)
    r._load_secondary_profile_config = AsyncMock(return_value=GatewayConfig(platforms={platform: saved}))
    r._create_adapter_off_loop_deps = AsyncMock(return_value=new)
    r._adapter_claims = Mock(return_value=(None, None))
    r._current_claim_owners = Mock(return_value={})
    r._wire_adapter_handlers = Mock()
    r._update_platform_runtime_status = Mock()
    r._connect_initial_adapter_with_timeout = AsyncMock(return_value=True)
    r._bounded_adapter_teardown = AsyncMock()

    async def publish(p, adapter):
        assert p in r._failed_platforms
        r.adapters[p] = adapter
        r._failed_platforms.pop(p)

    r._install_reconnected_adapter = AsyncMock(side_effect=publish)
    return r, platform, saved, new, home


@pytest.mark.asyncio
async def test_new_primary_platform_uses_existing_installer_and_preserves_other_sessions(runner):
    r, platform, _saved, new, home = runner
    local = r.adapters[Platform.LOCAL]
    result = await connect_platform(r, home, "weixin")
    assert result["ok"] and result["hot_served"] and not result["needs_restart"]
    assert result["state"] == "connected"
    assert r.adapters[Platform.LOCAL] is local
    assert r.adapters[platform] is new
    assert r._running
    r._bounded_adapter_teardown.assert_not_called()
    r._wire_adapter_handlers.assert_called_once_with(new)
    r._install_reconnected_adapter.assert_awaited_once_with(platform, new)


@pytest.mark.asyncio
async def test_reconfigure_waits_for_active_platform_work_but_idle_disable_is_local(runner):
    r, platform, saved, _new, home = runner
    old = SimpleNamespace(config=PlatformConfig(enabled=True, token="old-token"), _active_sessions={"chat": object()}, is_connected=True)
    r.adapters[platform] = old
    first = await connect_platform(r, home, "weixin")
    assert first["state"] == "busy" and not first["needs_restart"]
    assert r.adapters[platform] is old
    r._bounded_adapter_teardown.assert_not_called()
    old._active_sessions.clear()
    saved.enabled = False
    second = await connect_platform(r, home, "weixin")
    assert second["state"] == "stopped" and second["hot_served"]
    assert platform not in r.adapters and Platform.LOCAL in r.adapters
    r._bounded_adapter_teardown.assert_awaited_once_with(old, platform, profile="default")
    r._create_adapter_off_loop_deps.assert_not_called()


@pytest.mark.asyncio
async def test_connect_refuses_an_unserved_home_and_marks_no_session_ready(runner, tmp_path):
    r, _platform, _saved, _new, _home = runner
    result = await connect_platform(r, tmp_path / "unserved", "weixin")
    assert not result["ok"]
    r._create_adapter_off_loop_deps.assert_not_called()


@pytest.mark.asyncio
async def test_candidate_dialing_old_config_cannot_publish_after_disable(runner, monkeypatch):
    import gateway.run as facade

    r, platform, saved, new, _home = runner
    disposed = AsyncMock()
    monkeypatch.setattr(facade, "_dispose_unused_adapter", disposed)
    info = r._reconnect_queue_entry(platform, None, saved, attempts=0, delay=0)
    r._failed_platforms[platform] = info
    r._flag_reconnect_needs_attention = Mock()
    r._run_in_executor_with_context = AsyncMock()
    r._adapter_may_heal = Mock(return_value=False)

    async def dialing(adapter, platform, **kwargs):
        info["config"] = PlatformConfig(enabled=False, token="new-token")
        return True

    r._connect_adapter_with_timeout = AsyncMock(side_effect=dialing)
    await r._reconnect_failed_platform(platform, float("inf"))
    r._install_reconnected_adapter.assert_not_called()
    disposed.assert_awaited_once_with(new)
    assert platform not in r.adapters


@pytest.mark.asyncio
async def test_pending_wechat_batch_is_busy_before_an_agent_turn_exists(runner):
    from plugins.platforms.weixin.adapter import WeixinAdapter

    r, platform, _saved, _new, home = runner
    old = WeixinAdapter(PlatformConfig(enabled=True, token="old-token", extra={"account_id": "old-account"}))
    accepted = object()
    old._pending_text_batches["chat"] = accepted
    r.adapters[platform] = old
    result = await connect_platform(r, home, "weixin")
    assert result["state"] == "busy" and not result["hot_served"]
    assert old._pending_text_batches["chat"] is accepted
    r._bounded_adapter_teardown.assert_not_called()


def test_new_retry_credentials_are_checked_against_other_profiles(runner):
    from gateway.run_messaging_connect import prepare_primary_retry_claims

    r, platform, _saved, new, _home = runner
    old_claim, new_claim = (platform, "old-token"), (platform, "new-token")
    info = {"credential_claim": old_claim}
    r._failed_platforms[platform] = info
    r._adapter_claims.return_value = (new_claim, None)
    r._current_claim_owners.return_value = {new_claim: "another-bot", old_claim: "default"}
    assert not prepare_primary_retry_claims(r, platform, new, info)
    assert platform not in r._failed_platforms
    r._connect_initial_adapter_with_timeout.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.platforms("posix")
async def test_hot_connect_crosses_real_owner_control_socket(runner):
    from gateway.control_socket import GatewayControlServer, query_gateway_control
    from gateway.run_messaging_connect import connect_platform_verb

    r, platform, _saved, new, home = runner
    server = GatewayControlServer(home, verb_handlers={"connect-platform": connect_platform_verb(r, asyncio.get_running_loop())})
    assert await server.start()
    try:
        result = await asyncio.to_thread(query_gateway_control, home, "connect-platform",
                                         params={"profile_home": str(home), "platform": "weixin"}, timeout=8)
        assert result["ok"] and result["state"] == "connected"
        assert r.adapters[platform] is new and r._running
    finally:
        await server.stop()
