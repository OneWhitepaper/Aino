"""Account filtering and bounded canonical-import batches for legacy history."""
from __future__ import annotations

import copy
import json

from hermes_cli.desktop_history_recovery_store import owner_stamp
from hermes_state import SessionDB


def session_owner(session):
    raw = session.get("model_config")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            return None
    stamp = raw.get("platform_owner") if isinstance(raw, dict) else None
    if stamp is None:
        return None
    try:
        return owner_stamp(stamp)
    except ValueError:
        # An explicit invalid owner must never be claimed as unowned history.
        return {"invalid": True}


def lineages(sessions):
    """Connected parent chains, topologically ordered, without losing branches."""
    by_id = {session["id"]: session for session in sessions}
    parents = {sid: str(session.get("parent_session_id") or "") for sid, session in by_id.items()}
    neighbours = {sid: set() for sid in by_id}
    for sid, parent in parents.items():
        if parent in by_id:
            neighbours[sid].add(parent)
            neighbours[parent].add(sid)
    remaining = set(by_id)
    result = []
    while remaining:
        pending, component = [min(remaining)], set()
        while pending:
            current = pending.pop()
            if current not in component:
                component.add(current)
                pending.extend(neighbours[current] - component)
        remaining -= component
        result.append(_parent_first(component, by_id, parents))
    return result


def _parent_first(component, by_id, parents):
    ordered, pending = [], set(component)
    while pending:
        ready = sorted(sid for sid in pending if parents[sid] not in pending)
        if not ready:
            raise ValueError("history has a cyclic parent lineage")
        ordered.extend(by_id[sid] for sid in ready)
        pending.difference_update(ready)
    return ordered


def message_digest(session):
    # Database row IDs are local counters; message_uids and content carry identity.
    config = session.get("model_config") or {}
    if isinstance(config, str):
        config = json.loads(config)
    if config.get("recovered_group_history") is True:
        fields = ("role", "content", "timestamp", "message_uid")
        messages = [{key: message.get(key) for key in fields} for message in session.get("messages", [])]
    else:
        messages = [{key: value for key, value in message.items() if key not in {"id", "session_id"}}
                    for message in session.get("messages", [])]
    return json.dumps(messages, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def filter_components(sessions, owner, target_sessions, deleted):
    target = {session["id"]: session for session in target_sessions}
    counts = {"owned": 0, "unowned": 0, "foreign": 0, "conflicts": 0, "existing": 0, "deleted": 0}
    eligible = []
    for component in lineages(sessions):
        stamps = [session_owner(session) for session in component]
        if any(stamp is not None and stamp != owner for stamp in stamps):
            counts["foreign"] += len(component)
            continue
        blocked = _target_conflicts(component, target, deleted, counts)
        if blocked:
            continue
        new = [session for session in component if session["id"] not in target]
        counts["existing"] += len(component) - len(new)
        if new:
            category = "unowned" if any(stamp is None for stamp in stamps) else "owned"
            counts[category] += len(new)
            eligible.append({"ownership": category, "sessions": new})
    return eligible, counts


def _target_conflicts(component, target, deleted, counts):
    deleted_ids = [session["id"] for session in component if session["id"] in deleted]
    divergent = [session["id"] for session in component if session["id"] in target
                 and message_digest(session) != message_digest(target[session["id"]])]
    if deleted_ids or divergent:
        counts["deleted"] += len(deleted_ids)
        counts["conflicts"] += len(divergent)
        return True
    existing = [session for session in component if session["id"] in target]
    if existing and len(existing) != len(component):
        # A target row's matching content does not prove the import principal owns
        # it; the canonical importer would detach a child at that boundary.
        counts["conflicts"] += len(component) - len(existing)
        return True
    return False


def resolve_titles(sessions, target_sessions, metadata, profile):
    """Resolve the canonical store's global title uniqueness without touching it."""
    taken = {session.get("title") for session in target_sessions if session.get("title") is not None}
    result = copy.deepcopy(sessions)
    display_name = metadata.get("display_name") or (metadata.get("ui_meta") or {}).get("hermes-bots", {}).get("title") or profile
    _recover_bot_chains(result, taken, display_name)
    for session in result:
        config = session.get("model_config") or {}
        if session.get("source") == "bot_room" or config.get("room_plumbing") is True:
            session.update(source="import", hidden=0, title=f"群聊成员历史 · {display_name}")
            config.pop("follow_profile_config", None)
            config.pop("room_plumbing", None)
        title = session.get("title")
        if title is not None and title in taken:
            base = f"{display_name} · recovered conversation" if title == "Bot Chat" else f"{title} · recovered conversation"
            title = f"{base} ({session['id'][-12:]})"
            number = 2
            while title in taken:
                title = f"{base} ({session['id'][-12:]}-{number})"
                number += 1
            session["title"] = title
            session["hidden"] = 0
            if isinstance(session.get("model_config"), dict):
                session["model_config"].pop("follow_profile_config", None)
                session["model_config"].pop("room_plumbing", None)
        if title is not None:
            taken.add(title)
    return result


def _recover_bot_chains(sessions, taken, display_name):
    for component in lineages(sessions):
        if not any(session.get("title") == "Bot Chat" and "Bot Chat" in taken for session in component):
            continue
        for session in component:
            session["hidden"] = 0
            config = session.get("model_config")
            if isinstance(config, dict):
                config.pop("follow_profile_config", None)
                config.pop("room_plumbing", None)
            if session.get("title") in (None, "Bot Chat"):
                session["title"] = f"{display_name} · recovered conversation ({session['id'][-12:]})"


def session_size(session):
    return len(json.dumps({key: value for key, value in session.items() if key != "timings"},
                          ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def bounded_batches(components):
    batches, batch, total_bytes, total_messages = [], [], 0, 0
    oversized = 0
    for component in components:
        size = sum(session_size(session) for session in component)
        messages = sum(len(session.get("messages", [])) for session in component)
        if not _fits(component, size, messages):
            oversized += len(component)
            continue
        if batch and not _fits(batch + component, total_bytes + size, total_messages + messages):
            batches.append(batch)
            batch, total_bytes, total_messages = [], 0, 0
        batch.extend(component)
        total_bytes += size
        total_messages += messages
    if batch:
        batches.append(batch)
    return batches, oversized


def _fits(sessions, size, messages):
    return (len(sessions) <= SessionDB._IMPORT_MAX_SESSIONS
            and size <= SessionDB._IMPORT_MAX_TOTAL_BYTES
            and messages <= SessionDB._IMPORT_MAX_TOTAL_MESSAGES
            and all(session_size(session) <= SessionDB._IMPORT_MAX_SESSION_BYTES
                    and len(session.get("messages", [])) <= SessionDB._IMPORT_MAX_MESSAGES_PER_SESSION for session in sessions))
