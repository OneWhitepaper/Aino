"""Private snapshots and owner-bound receipts for desktop history recovery."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import sqlite3
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from hermes_cli.backup_sqlite import _safe_copy_db
from hermes_constants import PROFILE_ID_RE, named_profile_is_deleted
from hermes_state import SessionDB

PLAN_RE = re.compile(r"[a-f0-9]{32}\Z")


def owner_stamp(raw):
    if not isinstance(raw, dict):
        raise ValueError("owner is required")
    origin, user_id = raw.get("platform_origin"), raw.get("user_id")
    if not isinstance(origin, str) or not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("owner requires an origin and user_id")
    parsed = urlsplit(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("invalid owner origin")
    host = parsed.hostname.lower()
    host = f"[{host}]" if ":" in host else host
    port = parsed.port
    suffix = f":{port}" if port and port != {"http": 80, "https": 443}[parsed.scheme] else ""
    return {"platform_origin": f"{parsed.scheme}://{host}{suffix}", "user_id": user_id}


def profile_home(home, name):
    if name == "default":
        return home
    if not isinstance(name, str) or not PROFILE_ID_RE.fullmatch(name):
        raise ValueError("invalid profile name")
    return home / "profiles" / name


def plain_path(path):
    if path.is_symlink():
        raise ValueError("symlinked recovery paths are not allowed")
    return path


def private_dir(path):
    plain_path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def write_json(path, value):
    plain_path(path)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    with tmp.open("x", encoding="utf-8") as handle:
        if os.name != "nt":
            os.fchmod(handle.fileno(), 0o600)
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(path)


def validate_request(request):
    owner = owner_stamp(request.get("owner"))
    paths = [Path(str(request.get(key) or "")) for key in ("source_home", "user_data", "target_home")]
    if any(not path.is_absolute() for path in paths):
        raise ValueError("recovery paths must be absolute")
    source, user_data, target = (plain_path(path).resolve() for path in paths)
    if source.parent.name == "profiles" or any(part.name == "account-workspaces" for part in (source, *source.parents)):
        raise ValueError("source must be the legacy installation home")
    encoded = json.dumps(list(owner.values()), ensure_ascii=False, separators=(",", ":")).encode()
    expected = user_data / "account-workspaces" / hashlib.sha256(encoded).hexdigest() / "home"
    if target != expected:
        raise ValueError("target is not the owner's account workspace")
    if source == target or source in target.parents or target in source.parents:
        raise ValueError("source and target roots overlap")
    for part in (user_data / "account-workspaces", expected.parent, expected):
        plain_path(part)
    recovery = private_dir(user_data / "legacy-history-recovery")
    return source, user_data, target, owner, recovery


def discover_profiles(source):
    result = [("default", source)]
    root = plain_path(source / "profiles")
    if root.is_dir():
        for path in sorted(root.iterdir()):
            if PROFILE_ID_RE.fullmatch(path.name):
                plain_path(path)
                if path.is_dir() and not named_profile_is_deleted(path):
                    result.append((path.name, path))
    return [(name, home) for name, home in result
            if any(plain_path(home / database).is_file() for database in ("state.db", "shared-state.db"))]


def snapshot_sessions(home, destination, *, include_groups=False):
    """Only a private snapshot is writer-opened to upgrade legacy schemas."""
    source = plain_path(home / "state.db")
    if not source.is_file():
        groups = _group_history(None, home, destination) if include_groups else []
        return groups, set()
    db = None
    try:
        if not _safe_copy_db(source, destination):
            raise ValueError("could not take a consistent history snapshot")
        db = SessionDB(db_path=destination)
        from hermes_state_mutation_retirement import RETIRED_PREFIX
        with db._read_ctx() as connection:
            deleted = {row[0][len(RETIRED_PREFIX):] for row in connection.execute(
                "SELECT key FROM state_meta WHERE key LIKE ?", (RETIRED_PREFIX + "%",))}
        sessions = db.export_all(include_inactive=True)
        if include_groups:
            sessions.extend(_group_history(db, home, destination))
        return sessions, deleted
    finally:
        if db is not None:
            db.close()
        for suffix in ("", "-wal", "-shm"):
            destination.with_name(destination.name + suffix).unlink(missing_ok=True)


def _group_history(db, home, destination):
    from hermes_cli.desktop_history_recovery_groups import project_group_history, project_shared_group_history
    groups = project_group_history(db, home) if db is not None else []
    by_id = {session["id"]: session for session in groups}
    shared_snapshot = destination.with_name(destination.stem + "-shared.db")
    for session in project_shared_group_history(home, shared_snapshot):
        by_id.setdefault(session["id"], session)
    return list(by_id.values())


def load_plan(request, recovery, owner, source, target):
    plan_id = request.get("plan_id")
    if not isinstance(plan_id, str) or not PLAN_RE.fullmatch(plan_id):
        raise ValueError("invalid recovery plan")
    directory = plain_path(recovery / "plans" / plan_id)
    manifest = plain_path(directory / "manifest.json")
    data = json.loads(manifest.read_text(encoding="utf-8-sig"))
    if data["owner"] != owner or data["source"] != str(source) or data["target"] != str(target):
        raise ValueError("recovery plan owner or paths do not match")
    if data.get("expired"):
        raise ValueError("recovery plan expired; inspect history again")
    return directory, data


def prune_plans(recovery, owner, source, target):
    """Bound large exported manifests; backups remain available for manual rollback."""
    plans = []
    for directory in (recovery / "plans").iterdir():
        if not PLAN_RE.fullmatch(directory.name):
            continue
        plain_path(directory)
        manifest = plain_path(directory / "manifest.json")
        if not manifest.is_file():
            continue
        data = json.loads(manifest.read_text(encoding="utf-8-sig"))
        if (data.get("owner"), data.get("source"), data.get("target")) != (owner, str(source), str(target)):
            continue
        if not data.get("expired"):
            plans.append((directory.stat().st_mtime_ns, directory, data))
    for _created, directory, data in sorted(plans, reverse=True)[3:]:
        backup_dir = plain_path(directory / "backups")
        if backup_dir.is_dir() and any(backup_dir.iterdir()):
            write_json(directory / "manifest.json", {
                "owner": data["owner"], "source": data["source"], "target": data["target"],
                "expired": True, "groups": [],
            })
        else:
            shutil.rmtree(directory)


def claim_unknown(recovery, source_db, sessions, owner):
    """All members of a lineage are claimed atomically, including same-owner retries."""
    db_path = plain_path(recovery / "claims.db")
    descriptor = os.open(db_path, os.O_CREAT | os.O_WRONLY, 0o600)
    os.close(descriptor)
    source_key = hashlib.sha256(str(source_db).encode()).hexdigest()
    stamp = json.dumps(owner, sort_keys=True, separators=(",", ":"))
    with sqlite3.connect(db_path, timeout=10) as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS claims (source TEXT, session TEXT, owner TEXT, PRIMARY KEY(source, session))")
        connection.execute("BEGIN IMMEDIATE")
        for session in sessions:
            previous = connection.execute("SELECT owner FROM claims WHERE source=? AND session=?", (source_key, session["id"])).fetchone()
            if previous and previous[0] != stamp:
                return False
        connection.executemany("INSERT OR IGNORE INTO claims VALUES (?, ?, ?)",
                               [(source_key, session["id"], stamp) for session in sessions])
    return True


def unknown_available(recovery, source_db, sessions, owner):
    """Inspect claims without creating a ledger or claiming any history."""
    db_path = plain_path(recovery / "claims.db")
    if not db_path.is_file():
        return True
    source_key = hashlib.sha256(str(source_db).encode()).hexdigest()
    stamp = json.dumps(owner, sort_keys=True, separators=(",", ":"))
    with sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True) as connection:
        for session in sessions:
            row = connection.execute("SELECT owner FROM claims WHERE source=? AND session=?", (source_key, session["id"])).fetchone()
            if row and row[0] != stamp:
                return False
    return True


def safe_text(path, limit=1_000_000):
    plain_path(path)
    if not path.is_file() or path.stat().st_size > limit:
        return None
    return path.read_text(encoding="utf-8-sig")


def metadata_snapshot(home):
    import hermes_yaml as yaml
    raw = safe_text(home / "profile.yaml")
    data = yaml.safe_load(raw) if raw else {}
    data = data if isinstance(data, dict) else {}
    result = {key: data[key] for key in ("display_name", "description") if isinstance(data.get(key), str)}
    bot_meta = (data.get("ui_meta") or {}).get("hermes-bots") if isinstance(data.get("ui_meta"), dict) else None
    if isinstance(bot_meta, dict):
        result["ui_meta"] = {"hermes-bots": {key: value for key, value in bot_meta.items() if key != "chat"}}
    soul = safe_text(home / "SOUL.md")
    if soul is not None:
        result["soul"] = soul
    result["assets"] = _avatar_snapshot(home)
    return result


def _avatar_snapshot(home):
    assets = plain_path(home / "assets")
    signatures = {"png": [(0, b"\x89PNG\r\n\x1a\n")], "jpg": [(0, b"\xff\xd8\xff")],
                  "webp": [(0, b"RIFF"), (8, b"WEBP")]}
    for extension, magic in signatures.items():
        path = plain_path(assets / f"avatar.{extension}")
        if path.is_file() and path.stat().st_size <= 2_000_000:
            blob = path.read_bytes()
            if all(blob[start:start + len(signature)] == signature for start, signature in magic):
                return {f"avatar.{extension}": base64.b64encode(blob).decode("ascii")}
    return {}


def apply_metadata(home, metadata):
    """New profiles only: never copy credentials, model config, or runtime state."""
    from hermes_cli.profiles import write_profile_meta
    from utils import atomic_yaml_write
    plain_path(home / "profile.yaml")
    plain_path(home / "SOUL.md")
    write_profile_meta(home, **{key: metadata[key] for key in ("description", "display_name") if key in metadata})
    if metadata.get("ui_meta"):
        import hermes_yaml as yaml
        path = home / "profile.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}
        data["ui_meta"] = {**data.get("ui_meta", {}), **metadata["ui_meta"]}
        atomic_yaml_write(path, data, sort_keys=False)
    if "soul" in metadata:
        _write_private(home / "SOUL.md", metadata["soul"].encode("utf-8"))
    for name, encoded in metadata.get("assets", {}).items():
        _write_private(private_dir(home / "assets") / name, base64.b64decode(encoded, validate=True))
    return True


def _write_private(path, content):
    plain_path(path)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    with temporary.open("xb") as handle:
        if os.name != "nt":
            os.fchmod(handle.fileno(), 0o600)
        handle.write(content)
    temporary.replace(path)
