"""Onboarding uses the existing transport-bound Aino model authority before its opening turn."""

from tui_gateway.methods_session_model_guard import create_overrides


def selection(params: dict) -> dict | None:
    managed = create_overrides(params)[3]
    if managed is None:
        return None
    owner = params.get("platform_owner")
    if not isinstance(owner, dict) or not all(owner.get(k) for k in ("platform_origin", "user_id")):
        raise ValueError("platform owner required for managed onboarding")
    return {**managed, "platform_owner": {k: owner[k] for k in ("platform_origin", "user_id")}}


def store_selection(db, session_id: str, managed: dict | None) -> None:
    if managed is not None:
        db.patch_session_model_config(session_id, managed)


def validate_reopen(db, session_id: str, managed: dict | None) -> dict | None:
    from tui_gateway.managed_session import managed_metadata
    fields = ("model_source", "model_id", "platform_owner")
    stored = managed_metadata({key: db.get_session_model_config_value(session_id, key) for key in fields})
    if managed is not None and stored != managed:
        raise ValueError("managed onboarding model or owner changed; start a new run")
    return stored


def opening_pending(session_id: str, managed: dict | None) -> bool:
    from tui_gateway import server
    from tui_gateway.managed_session import submit_refusal
    with server._sessions_lock:
        session = server._sessions.get(session_id)
        return bool(managed) if session is None else bool(submit_refusal(session_id, session))
