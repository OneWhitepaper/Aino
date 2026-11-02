"""Begin/end correlation for a desktop turn without changing its prompt."""

from uuid import NAMESPACE_OID, uuid4, uuid5

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, billing_scope


def usage_session_id(session):
    from tui_gateway import server
    from tui_gateway.managed_model_runtime import ManagedBindingError
    session_key = session["session_key"]
    with server._session_db(session) as db:
        if db is None:
            raise ManagedBindingError("managed_auth_unavailable")
        lineage = db.get_compression_lineage(session_key)
    return str(uuid5(NAMESPACE_OID, lineage[0] if lineage else session_key))


def begin_managed_usage(agent):
    key = getattr(agent, "api_key", None)
    scope = (BillingScope("aino", key.user_id, key.session_id, str(uuid4()), "chat")
             if isinstance(key, ManagedCredential) else BillingScope(
                 "turn", None, str(getattr(agent, "session_id", "") or ""), str(uuid4()), "chat"))
    return billing_scope.set(scope)


def end_managed_usage(token):
    billing_scope.reset(token)


def current_usage_metadata():
    scope = billing_scope.get()
    if not scope:
        return {}
    snapshot = scope.calls.snapshot()
    outside_aino = snapshot.pop("non_aino_model_calls", False)
    metadata = {"non_aino_model_calls": True} if outside_aino else {}
    owner = (scope.user_id, scope.session_id) if scope.source == "aino" else scope.calls.managed_owner()
    if owner is not None:
        metadata["billing"] = {"source": "aino", "user_id": owner[0],
                               "session_id": owner[1], "turn_id": scope.turn_id,
                               "status": "pending", **snapshot}
    return metadata
