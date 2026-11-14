"""Non-interactive Feishu/Lark device registration for the messaging settings API."""

from __future__ import annotations

import asyncio

from hermes_cli.config import get_env_value, save_env_value, write_platform_config_field
from hermes_constants import reset_hermes_home_override, set_hermes_home_override


async def start(home: str) -> dict:
    from . import adapter

    def begin():
        adapter._init_registration("feishu")
        return adapter._begin_registration("feishu")

    registration = await asyncio.to_thread(begin)
    if not registration.get("qr_url"):
        raise ValueError("Feishu registration did not return a QR URL")
    return {
        "state": {"device_code": registration["device_code"], "domain": "feishu"},
        "qr_payload": registration["qr_url"], "expires_in": registration["expire_in"],
        "poll_interval": registration["interval"],
    }


async def poll(home: str, state: dict) -> dict:
    from . import adapter

    response = await asyncio.to_thread(
        adapter._post_registration, adapter._accounts_base_url(state["domain"]),
        {"action": "poll", "device_code": state["device_code"], "tp": "ob_app"},
    )
    user = response.get("user_info") or {}
    updated = {**state, "domain": "lark" if user.get("tenant_brand") == "lark" else state["domain"]}
    if response.get("client_id") and response.get("client_secret"):
        return {"status": "ready", "state": {
            **updated, "app_id": response["client_id"], "app_secret": response["client_secret"], "owner": user.get("open_id"),
        }}
    if response.get("error") == "expired_token":
        return {"status": "expired"}
    if response.get("error") == "access_denied":
        return {"status": "error", "message": "Authorization was declined. Start again to connect."}
    return {"status": "waiting", "state": updated}


def apply(home: str, state: dict) -> dict:
    app_id, secret = state.get("app_id"), state.get("app_secret")
    if not app_id or not secret:
        raise ValueError("Feishu registration returned incomplete credentials")
    token = set_hermes_home_override(home)
    try:
        for key, value in (
            ("FEISHU_APP_ID", app_id), ("FEISHU_APP_SECRET", secret), ("FEISHU_DOMAIN", state["domain"]),
            ("FEISHU_CONNECTION_MODE", "websocket"),
        ):
            save_env_value(key, value)
        if get_env_value("FEISHU_ALLOW_ALL_USERS") is None:
            save_env_value("FEISHU_ALLOW_ALL_USERS", "false")
        users = [value.strip() for value in (get_env_value("FEISHU_ALLOWED_USERS") or "").split(",") if value.strip()]
        if state.get("owner") and state["owner"] not in users:
            save_env_value("FEISHU_ALLOWED_USERS", ",".join([*users, state["owner"]]))
        write_platform_config_field("feishu", "enabled", True)
    finally:
        reset_hermes_home_override(token)
    return {"account_id": app_id}
