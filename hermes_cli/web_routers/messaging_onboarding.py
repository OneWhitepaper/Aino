"""Profile-owned QR onboarding over the messaging platform's registered setup callbacks.

Opaque credentials never cross the REST boundary. Scanning only prepares a grant;
explicit apply saves it, and the separate connect endpoint activates the adapter.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

from hermes_constants import get_hermes_home
from hermes_cli.web_server_profiles import _config_profile_scope

router = APIRouter()
_log = logging.getLogger(__name__)
_lock = threading.RLock()


@dataclass
class _Pairing:
    home: str
    platform: str
    expires: float
    state: dict
    qr_payload: str
    status: str = "waiting"
    message: str | None = None
    receipt: dict | None = None
    poll_interval: int = 2
    guard: threading.Lock = field(default_factory=threading.Lock)


_pairings: dict[str, _Pairing] = {}


def _entry(platform: str):
    from hermes_cli.web_server_messaging import _messaging_platform_catalog
    from gateway.platform_registry import platform_registry

    _messaging_platform_catalog()  # Discovery and registration run in the request's profile.
    entry = platform_registry.get(platform)
    if entry is None or not all((entry.onboarding_start, entry.onboarding_poll, entry.onboarding_apply)):
        raise HTTPException(404, "QR setup is unavailable for this platform.")
    return entry


def _home() -> str:
    return str(get_hermes_home().resolve())


def _record(platform: str, pairing_id: str) -> _Pairing:
    with _lock:
        record = _pairings.get(pairing_id)
        if record is None or record.home != _home() or record.platform != platform:
            raise HTTPException(404, "Setup session not found. Start a new setup.")
        if record.expires <= time.time() and record.receipt is None and record.status != "applying":
            record.status = "expired"
            record.state = {}
        return record


def _payload(pairing_id: str, record: _Pairing) -> dict:
    # This allowlist is the credential boundary. Never return a plugin's opaque state.
    return {"pairing_id": pairing_id, "status": "ready" if record.status == "applying" else record.status,
            "qr_payload": record.qr_payload,
            "expires_at": datetime.fromtimestamp(record.expires, UTC).isoformat(),
            "message": record.message, "poll_interval": record.poll_interval}


def _setup_failed(record: _Pairing) -> None:
    record.status = "error"
    record.message = "Connection setup failed. Please try again."
    record.state = {}


def _reserve_pairing(home: str, platform: str) -> tuple[str, _Pairing]:
    record = _Pairing(home, platform, time.time() + 300, {}, "", status="starting")
    pairing_id = secrets.token_urlsafe(24)
    with _lock:
        for key, old in list(_pairings.items()):
            if old.home == home and old.platform == platform and old.status == "applying":
                raise HTTPException(409, "This connection is being saved. Please wait.")
            if old.status != "applying" and (old.expires <= time.time() or (old.home == home and old.platform == platform)):
                del _pairings[key]
        _pairings[pairing_id] = record
    return pairing_id, record


@router.post("/api/messaging/platforms/{platform}/onboarding/start")
async def start_onboarding(platform: str, profile: Optional[str] = None):
    with _config_profile_scope(profile):
        entry, home = await asyncio.to_thread(_entry, platform), _home()
        pairing_id, record = _reserve_pairing(home, platform)
        try:
            result = await asyncio.wait_for(entry.onboarding_start(home), timeout=40)
        except Exception:  # health: allow BLE001 -- platform network/SDK errors must not leak credentials
            with _lock:
                _pairings.pop(pairing_id, None)
            _log.warning("QR setup start failed for %s", platform, exc_info=True)
            raise HTTPException(502, "Could not load the QR code. Please try again.") from None
        qr = str(result.get("qr_payload") or "").strip()
        if not qr:
            with _lock:
                _pairings.pop(pairing_id, None)
            raise HTTPException(502, "The service did not return a QR code. Please try again.")
        with _lock:
            if _pairings.get(pairing_id) is not record:
                raise HTTPException(409, "This QR code was replaced by a newer setup.")
            record.state, record.qr_payload, record.status = result.get("state") or {}, qr, "waiting"
            record.expires = time.time() + max(30, min(900, int(result.get("expires_in", 300))))
            record.poll_interval = max(1, min(30, int(result.get("poll_interval", 2))))
        return _payload(pairing_id, record)


@router.get("/api/messaging/platforms/{platform}/onboarding/{pairing_id}")
async def poll_onboarding(platform: str, pairing_id: str, profile: Optional[str] = None):
    with _config_profile_scope(profile):
        record = _record(platform, pairing_id)
        if record.status in {"ready", "expired", "error", "applied"} or not record.guard.acquire(False):
            return _payload(pairing_id, record)
        try:
            entry = await asyncio.to_thread(_entry, platform)
            try:
                result = await asyncio.wait_for(entry.onboarding_poll(record.home, record.state), timeout=40)
            except TimeoutError:
                return _payload(pairing_id, record)
            except Exception:  # health: allow BLE001 -- plugin/transport failure becomes a bounded setup state
                _log.warning("QR setup poll failed for %s", platform, exc_info=True)
                _setup_failed(record)
                return _payload(pairing_id, record)
            status = result.get("status", "waiting")
            record.status = status if status in {"waiting", "scanned", "ready", "expired", "error"} else "error"
            record.message = result.get("message")
            if isinstance(result.get("state"), dict):
                record.state = result["state"]
            if record.status in {"expired", "error"}:
                record.state = {}
            return _payload(pairing_id, record)
        finally:
            record.guard.release()


@router.post("/api/messaging/platforms/{platform}/onboarding/{pairing_id}/apply")
async def apply_onboarding(platform: str, pairing_id: str, profile: Optional[str] = None):
    with _config_profile_scope(profile):
        record = _record(platform, pairing_id)
        if record.receipt is not None:
            return record.receipt
        if record.status != "ready" or not record.guard.acquire(False):
            raise HTTPException(409, "Setup is not ready yet.")
        record.status = "applying"
        try:
            entry = await asyncio.to_thread(_entry, platform)
            try:
                result = await asyncio.to_thread(entry.onboarding_apply, record.home, record.state)
            except Exception:  # health: allow BLE001 -- keep the confirmed grant available after a storage failure
                record.status = "ready"
                _log.warning("QR setup save failed for %s", platform, exc_info=True)
                raise HTTPException(500, "Could not save this connection. Please try again.") from None
            receipt = {"ok": True, "platform": platform, "needs_activation": True}
            for key in ("account_id", "account_name"):
                if result.get(key):
                    receipt[key] = str(result[key])
            record.receipt, record.status, record.state = receipt, "applied", {}
            return receipt
        finally:
            if record.status == "applying":
                record.status = "ready"
            record.guard.release()


@router.delete("/api/messaging/platforms/{platform}/onboarding/{pairing_id}")
async def cancel_onboarding(platform: str, pairing_id: str, profile: Optional[str] = None):
    with _config_profile_scope(profile):
        record = _record(platform, pairing_id)
        if not record.guard.acquire(False):
            raise HTTPException(409, "Setup is completing. Please wait.")
        try:
            with _lock:
                _pairings.pop(pairing_id, None)
            record.state = {}
            return {"ok": True}
        finally:
            record.guard.release()


def _connect_saved_platform(home: str, platform: str) -> dict:
    from pathlib import Path
    from gateway.control_socket import query_gateway_control
    from hermes_cli.gateway_runtime import control_home_for, discover_gateway_endpoint

    target = Path(home)
    discovery = discover_gateway_endpoint(target)
    if discovery.endpoint is None:
        return {"ok": False, "hot_served": False, "needs_restart": True,
                "state": "configured", "message": "Connection saved. Start the running service to connect."}
    answer = query_gateway_control(control_home_for(target, discovery.endpoint), "connect-platform",
                                   params={"profile_home": home, "platform": platform}, timeout=8)
    if not isinstance(answer, dict) or "hot_served" not in answer:
        return {"ok": False, "hot_served": False, "needs_restart": True,
                "state": "configured", "message": "Connection saved. Restart the running service to apply it."}
    return answer


@router.post("/api/messaging/platforms/{platform}/connect")
async def connect_messaging_platform(platform: str, profile: Optional[str] = None):
    with _config_profile_scope(profile):
        from hermes_cli.web_routers.messaging import _require_platform
        await asyncio.to_thread(_require_platform, platform)
        return await asyncio.to_thread(_connect_saved_platform, _home(), platform)
