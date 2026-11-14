"""Connect a newly configured messaging adapter without replacing the session owner."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def _receipt(state: str, *, ok: bool = True, message: str | None = None, restart: bool = False) -> dict:
    return {"ok": ok, "hot_served": ok and not restart, "needs_restart": restart, "state": state, "message": message}


def adapter_has_inbound_work(adapter) -> bool:
    """Include accepted input still batching/debouncing, before a session guard exists."""
    event_stores = ("_active_sessions", "_pending_messages", "_text_debounce", "_pending_text_batches",
                    "_pending_photo_batches", "_media_group_events", "_pending_media_batches",
                    "_held_inbound_events", "_pending_inbound_events", "_pending_responses")
    if any(getattr(adapter, name, None) for name in event_stores):
        return True
    for name in ("_background_tasks", "_session_tasks", "_pending_text_batch_tasks",
                 "_pending_photo_batch_tasks", "_media_group_tasks", "_pending_media_batch_tasks"):
        tasks = getattr(adapter, name, ())
        values = tasks.values() if isinstance(tasks, dict) else tasks
        if any(not task.done() for task in values):
            return True
    return False


def prepare_primary_retry_claims(runner, platform, adapter, info) -> bool:
    """A configuration change during an outage must claim the new bot, not the old one."""
    active = getattr(runner, "_primary_profile_name", None) or "default"
    claims = runner._adapter_claims(platform, adapter)
    owners = runner._current_claim_owners()
    if any(claim is not None and owners.get(claim) not in (None, active) for claim in claims):
        runner._update_platform_runtime_status(platform.value, platform_state="fatal", error_code="duplicate_credential",
                                              error_message="This connection is already used by another bot.")
        runner._drop_from_reconnect_queue(platform, "configured connection is owned by another profile")
        # As on secondary refusal, never disconnect a duplicate that might own a shared sidecar.
        return False
    info["credential_claim"], info["listener_claim"] = claims
    runner._hold_secondary_claims(active, platform, adapter, claims)
    return True


async def _connect_primary(runner, name, home, platform, config):
    from gateway.run import _profile_runtime_scope

    adapter = None
    with _profile_runtime_scope(home, hydrate_secrets=False):
        adapter = await runner._create_adapter_off_loop_deps(platform, config)
        if adapter is None:
            return _receipt("error", ok=False, message="The platform adapter is unavailable.")
        claims = runner._adapter_claims(platform, adapter)
        owners = runner._current_claim_owners()
        if any(claim is not None and claim in owners for claim in claims):
            return _receipt("error", ok=False, message="This connection is already used by another bot.")
        runner._hold_secondary_claims(name, platform, adapter, claims)
        try:
            runner._wire_adapter_handlers(adapter)
            runner.config.platforms[platform] = config
            runner._update_platform_runtime_status(platform.value, platform_state="connecting", error_code=None, error_message=None)
            try:
                connected = await runner._connect_initial_adapter_with_timeout(adapter, platform)
            except Exception:  # health: allow BLE001 -- an adapter failure must not stop the owner or other platforms
                logger.warning("Messaging adapter connect failed: %s", platform.value, exc_info=True)
                connected = False
            if connected:
                # The existing installer owns publication, dedup handover, queued delivery and recovery.
                runner._failed_platforms[platform] = runner._reconnect_queue_entry(platform, None, config, attempts=0, delay=0)
                await runner._install_reconnected_adapter(platform, adapter)
                return _receipt("connected")
            await runner._safe_adapter_disconnect(adapter, platform)
            if adapter.fatal_error_retryable:
                runner._failed_platforms[platform] = runner._reconnect_queue_entry(platform, adapter, config, attempts=0, delay=0)
                runner._ensure_reconnect_watcher_running()
                return _receipt("connecting", message="The platform is retrying the connection.")
            runner._mark_platform_fatal(platform.value, adapter)
            return _receipt("error", ok=False, message="The platform refused the connection. Check authorization and retry.")
        finally:
            runner._release_secondary_claims(name, platform, adapter)


def _resolve_route(runner, home: Path):
    from hermes_constants import get_process_hermes_home
    home = Path(home).resolve()
    launch = get_process_hermes_home().resolve()
    active = getattr(runner, "_primary_profile_name", None) or "default"
    homes = {**(runner._served_profile_homes or {}), active: launch}
    name = next((name for name, path in homes.items() if Path(path).resolve() == home), None)
    return home, launch, name


async def connect_platform(runner, home: Path, platform_id: str) -> dict:
    """Hot-add only the selected profile/platform; leave sessions and other adapters intact."""
    from gateway.config import Platform

    if not runner._running:
        return _receipt("error", ok=False, message="The running service is shutting down.")
    home, launch, name = await asyncio.to_thread(_resolve_route, runner, home)
    if name is None:
        return _receipt("error", ok=False, message="This bot is not served by the running service.")
    try:
        platform = Platform(platform_id)
    except ValueError:
        return _receipt("error", ok=False, message="Unknown messaging platform.")
    async with runner._reconcile_lock():
        config = await runner._load_secondary_profile_config(name, home)
        pconfig = config.platforms.get(platform)
        if pconfig is None:
            return _receipt("not_configured", ok=False, message="Save this connection first.")
        primary = home == launch
        adapters = runner.adapters if primary else runner._profile_adapters.get(name, {})
        existing = adapters.get(platform)
        if existing is not None and existing.config == pconfig and pconfig.enabled and existing.is_connected:
            return _receipt("connected")
        if existing is not None and adapter_has_inbound_work(existing):
            return _receipt("busy", ok=False, message="Saved. This platform is handling messages. Retry connection when it finishes.")
        if existing is not None:
            from gateway.run import _profile_runtime_scope
            with _profile_runtime_scope(home, hydrate_secrets=False):
                await runner._bounded_adapter_teardown(existing, platform, profile=name)
            adapters.pop(platform, None)
            if primary:
                runner.delivery_router.adapters = runner.adapters
        if not pconfig.enabled:
            if primary:
                runner.config.platforms[platform] = pconfig
                queued = runner._failed_platforms.get(platform)
                if queued is not None:
                    queued.update(config=pconfig, next_retry=0, paused=False)
            else:
                queued = (runner._profile_failed_platforms or {}).get(name, {}).get(platform)
                if isinstance(queued, asyncio.Task):
                    queued.cancel()
                    await asyncio.wait({queued}, timeout=runner._adapter_disconnect_timeout_secs())
            key = platform.value if primary else f"{name}:{platform.value}"
            runner._update_platform_runtime_status(key, platform_state="disabled", error_code=None, error_message=None)
            return _receipt("stopped")
        if not primary:
            await runner._start_one_profile_adapters(name, home, runner._current_claim_owners(), platform_filter=platform)
            return _receipt("connected" if platform in runner._profile_adapters.get(name, {}) else "connecting")
        if platform in runner._failed_platforms:
            info = runner._failed_platforms[platform]
            info.update(config=pconfig, next_retry=0, retry_now=True, paused=False)
            runner._ensure_reconnect_watcher_running()
            return _receipt("connecting")
        return await _connect_primary(runner, name, home, platform, pconfig)


def connect_platform_verb(runner, loop):
    """Control handlers run in an executor; the adapter belongs to the owner's event loop."""
    def handler(params):
        home, platform = params.get("profile_home"), params.get("platform")
        if not isinstance(home, str) or not isinstance(platform, str):
            return _receipt("error", ok=False, message="A profile and platform are required.")
        future = asyncio.run_coroutine_threadsafe(connect_platform(runner, Path(home), platform), loop)
        try:
            return future.result(timeout=5)
        except TimeoutError:
            return _receipt("connecting")
        except Exception:  # health: allow BLE001 -- private control replies never expose platform credentials
            logger.warning("Messaging hot-connect failed", exc_info=True)
            return _receipt("error", ok=False, message="The platform could not be connected. Please retry.")
    return handler
