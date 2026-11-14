"""Project old group logs into read-only history, never room execution state."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from hermes_cli.backup_sqlite import _safe_copy_db
from hermes_state import SessionDB

_ROOM_TABLES = (("hosted_rooms", "hosted_room_events"),
                ("hosted_room_replicas", "hosted_room_replica_events"))
_MESSAGE_KINDS = {"message.user", "message.member", "message.created"}


def _identifier(*parts):
    encoded = json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:32]


def _object(raw):
    value = json.loads(raw) if isinstance(raw, str) else raw
    return value if isinstance(value, dict) else {}


def _columns(connection, table):
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def _speaker(actor, members, role):
    if isinstance(actor.get("display_name"), str) and actor["display_name"].strip():
        return actor["display_name"].strip()
    if role == "user":
        return "用户"
    for member in members:
        if not isinstance(member, dict):
            continue
        identities = {member.get(key) for key in ("profile", "handle", "member_id") if isinstance(member.get(key), str)}
        if actor.get("id") in identities or actor.get("profile") in identities:
            return member.get("display_name") or member.get("handle") or "机器人"
    return "机器人"


def _message(event, members, source, room_id):
    if event["kind"] not in _MESSAGE_KINDS:
        return None
    payload = _object(event["payload_json"])
    actor = _object(event["actor_json"])
    role = "assistant" if event["kind"] == "message.member" or payload.get("role") == "assistant" else "user"
    text = payload.get("text", payload.get("content", ""))
    text = text if isinstance(text, str) else ""
    attachments = payload.get("attachments")
    names = [item["name"] for item in attachments if isinstance(item, dict) and isinstance(item.get("name"), str)] \
        if isinstance(attachments, list) else []
    if names:
        text += ("\n\n" if text else "") + "\n".join(f"[附件：{name}]" for name in names)
    if not text:
        return None
    return {"role": role, "content": f"{_speaker(actor, members, role)}\n\n{text}",
            "timestamp": float(event["created_at"]),
            "message_uid": _identifier(source, room_id, event["event_id"], event["seq"])}


def _messages(connection, events_table, room, source):
    columns = _columns(connection, events_table)
    actor = "actor_json" if "actor_json" in columns else "'{}' AS actor_json"
    rows = connection.execute(
        f"SELECT seq,event_id,kind,{actor},payload_json,created_at FROM {events_table} WHERE room_id=? ORDER BY seq",
        (room["room_id"],)).fetchall()
    members = json.loads(room.get("members_json") or "[]")
    members = members if isinstance(members, list) else []
    return [message for event in rows if (message := _message(dict(event), members, source, room["room_id"]))]


def _chunks(messages):
    # Independent archive parts preserve long rooms without creating an oversized
    # compression lineage the canonical import API could never admit atomically.
    maximum_bytes = SessionDB._IMPORT_MAX_SESSION_BYTES - 16_384
    result, chunk, size = [], [], 0
    for message in messages:
        message_size = len(json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
        if chunk and (len(chunk) >= SessionDB._IMPORT_MAX_MESSAGES_PER_SESSION or size + message_size > maximum_bytes):
            result.append(chunk)
            chunk, size = [], 0
        chunk.append(message)
        size += message_size
    if chunk:
        result.append(chunk)
    return result


def _archives(room, messages, source):
    result = []
    for number, chunk in enumerate(_chunks(messages), 1):
        name = str(room.get("name") or "未命名群聊")
        title = f"群聊历史 · {name}" + (f"（{number}）" if number > 1 else "")
        config = {"recovered_group_history": True, "recovered_group_name": name}
        # Current room schemas carry only an OS owner, which cannot establish an
        # Aino account. Future explicit platform metadata keeps the normal filter.
        if room.get("platform_owner") is not None:
            config["platform_owner"] = _object(room["platform_owner"])
        result.append({"id": "recovered-group-" + _identifier(source, room["room_id"], number),
                       "source": "import", "title": title, "hidden": 0, "archived": 0,
                       "started_at": float(room["created_at"]), "ended_at": chunk[-1]["timestamp"],
                       "end_reason": "recovered_group_history", "model_config": config, "messages": chunk})
    return result


def _project(connection, source_home):
    source = str(Path(source_home).resolve())
    result, known_rooms = [], set()
    for rooms_table, events_table in _ROOM_TABLES:
        if not _columns(connection, rooms_table):
            continue
        if not _columns(connection, events_table):
            raise ValueError("group history has no event table")
        rows = connection.execute(f"SELECT * FROM {rooms_table} ORDER BY created_at,room_id").fetchall()
        for raw in rows:
            room = dict(raw)
            if room["room_id"] in known_rooms:
                continue
            known_rooms.add(room["room_id"])
            result.extend(_archives(room, _messages(connection, events_table, room, source), source))
    return result


def project_group_history(db, source_home):
    """Read a caller-owned private state.db snapshot; no room tasks are imported."""
    with db._read_ctx() as connection:
        return _project(connection, source_home)


def project_shared_group_history(source_home, destination):
    """Read standalone group storage through the same WAL-safe snapshot protocol."""
    source = Path(source_home) / "shared-state.db"
    destination = Path(destination)
    if source.is_symlink() or destination.is_symlink():
        raise ValueError("symlinked recovery paths are not allowed")
    if not source.is_file():
        return []
    try:
        if not _safe_copy_db(source, destination):
            raise ValueError("could not take a consistent group history snapshot")
        connection = sqlite3.connect(f"{destination.resolve().as_uri()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            return _project(connection, source_home)
        finally:
            connection.close()
    finally:
        for suffix in ("", "-wal", "-shm"):
            destination.with_name(destination.name + suffix).unlink(missing_ok=True)
