"""Non-interactive QQ scan-to-configure callbacks for the messaging settings API."""

from __future__ import annotations

import asyncio

from hermes_cli.config import get_env_value, save_env_value, write_platform_config_field
from hermes_constants import reset_hermes_home_override, set_hermes_home_override

from . import onboard


async def start(home: str) -> dict:
    task_id, aes_key = await asyncio.to_thread(onboard._create_bind_task)
    return {
        "state": {"task_id": task_id, "aes_key": aes_key},
        "qr_payload": onboard.build_connect_url(task_id), "expires_in": 600, "poll_interval": 2,
    }


async def poll(home: str, state: dict) -> dict:
    status, app_id, encrypted_secret, owner = await asyncio.to_thread(onboard._poll_bind_result, state["task_id"])
    if status == onboard.BindStatus.EXPIRED:
        return {"status": "expired"}
    if status != onboard.BindStatus.COMPLETED:
        return {"status": "waiting"}
    secret = onboard.decrypt_secret(encrypted_secret, state["aes_key"]) if encrypted_secret else ""
    if not app_id or not secret:
        raise ValueError("QQ registration returned incomplete credentials")
    return {"status": "ready", "state": {**state, "app_id": app_id, "client_secret": secret, "owner": owner}}


def apply(home: str, state: dict) -> dict:
    app_id, secret = state.get("app_id"), state.get("client_secret")
    if not app_id or not secret:
        raise ValueError("QQ registration returned incomplete credentials")
    token = set_hermes_home_override(home)
    try:
        save_env_value("QQ_APP_ID", app_id)
        save_env_value("QQ_CLIENT_SECRET", secret)
        # Keep existing authorization choices; the scanning owner can use a newly connected bot.
        if get_env_value("QQ_ALLOW_ALL_USERS") is None:
            save_env_value("QQ_ALLOW_ALL_USERS", "false")
        users = [value.strip() for value in (get_env_value("QQ_ALLOWED_USERS") or "").split(",") if value.strip()]
        if state.get("owner") and state["owner"] not in users:
            save_env_value("QQ_ALLOWED_USERS", ",".join([*users, state["owner"]]))
        write_platform_config_field("qqbot", "enabled", True)
    finally:
        reset_hermes_home_override(token)
    return {"account_id": app_id}
