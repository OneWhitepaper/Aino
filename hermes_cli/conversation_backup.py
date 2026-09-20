"""Coordinated, verifiable recovery sets for ordinary multi-agent conversations.

These bundles contain private Profile databases as well as public history. They
are recovery artifacts, never public conversation exports.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import uuid
from contextlib import closing
from pathlib import Path, PurePosixPath
from typing import Any

MANIFEST_NAME = "conversation-manifest.json"
FORMAT_VERSION = 1


class ConversationBackupError(RuntimeError):
    """A recovery set is incomplete, inconsistent, or unsafe to install."""


def shared_root(home: Path) -> Path:
    home = Path(home).resolve()
    return home.parent.parent if home.parent.name == "profiles" else home


def profile_relative_home(profile: str) -> Path:
    if not isinstance(profile, str) or not profile or profile in (".", "..") or any(
            char in profile for char in ("/", "\\", "\0")):
        raise ConversationBackupError("Invalid Profile identity in recovery set")
    return Path() if profile == "default" else Path("profiles") / profile


def safe_member(root: Path, name: str) -> Path:
    if not isinstance(name, str):
        raise ConversationBackupError("Invalid recovery member path")
    relative = PurePosixPath(name)
    if ("\\" in name or relative.is_absolute()
            or ".." in relative.parts or str(relative) != name or name in ("", ".")):
        raise ConversationBackupError("Invalid recovery member path")
    path = root / name
    members = [root.joinpath(*relative.parts[:index]) for index in range(1, len(relative.parts) + 1)]
    if not path.resolve().is_relative_to(root.resolve()) or any(member.is_symlink() for member in members):
        raise ConversationBackupError("Recovery members must be regular paths inside the bundle")
    return path


def read_db(path: Path):
    if not path.is_file():
        raise ConversationBackupError(f"Missing required database: {path.name}")
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def rows(conn, table: str) -> list[dict[str, Any]]:
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is None:
        return []
    # Names are internal constants, never archive or client input.
    return [dict(row) for row in conn.execute(f'SELECT * FROM "{table}"')]


def has_conversations(root: Path) -> bool:
    db = shared_root(root) / "shared-state.db"
    if not db.is_file():
        return False
    with closing(read_db(db)) as conn:
        return bool(rows(conn, "hosted_room_conversations"))


def _hash(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"sha256": digest.hexdigest(), "size_bytes": path.stat().st_size}


def _schema(path: Path) -> dict[str, Any]:
    with closing(read_db(path)) as conn:
        definitions = [tuple(row) for row in conn.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")]
        return {"user_version": conn.execute("PRAGMA user_version").fetchone()[0],
                "application_id": conn.execute("PRAGMA application_id").fetchone()[0],
                "ddl_sha256": hashlib.sha256(json.dumps(definitions).encode()).hexdigest()}


def _dependency_files(root: Path, conn) -> set[str]:
    profiles = {row["profile"] for row in rows(conn, "hosted_room_conversation_participants")}
    profiles.update(row["profile"] for row in rows(conn, "hosted_room_conversation_runtimes"))
    # Adopted source lineages remain part of the recovery proof.
    profiles.update(json.loads(row["receipt_json"])["source_profile"]
                    for row in rows(conn, "hosted_conversation_migrations"))
    required = {"shared-state.db", "install_id"}
    for row in rows(conn, "hosted_room_conversations"):
        if row["project_json"]:
            project = json.loads(row["project_json"])
            required.add((profile_relative_home(project["registration_profile"]) / "projects.db").as_posix())
    for profile in profiles:
        relative = profile_relative_home(profile)
        for filename in ("state.db", "projects.db", "config.yaml", "SOUL.md"):
            name = (relative / filename).as_posix()
            if safe_member(root, name).is_file():
                required.add(name)
    return required


def create_conversation_snapshot(root: Path, destination: Path, *, timeout: float = 30.0) -> dict:
    """Publish one verified dependency set, or leave no destination on failure."""
    from gateway.hosted_room_conversation_maintenance import snapshot_operation
    from hermes_cli.backup import _safe_copy_db

    root, destination = shared_root(root), Path(destination)
    if destination.exists():
        raise ConversationBackupError("Snapshot destination already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".conversation-snapshot-", dir=destination.parent))
    try:
        with snapshot_operation(root, timeout=timeout):
            if (root / ".conversation-restore.json").exists():
                raise ConversationBackupError("Recover the interrupted restore before taking a new snapshot")
            with closing(read_db(root / "shared-state.db")) as conn:
                members = _dependency_files(root, conn)
            for name in sorted(members, key=lambda item: (item != "shared-state.db", item)):
                source, target = safe_member(root, name), safe_member(staging, name)
                if not source.is_file():
                    raise ConversationBackupError(f"Missing snapshot dependency: {name}")
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if source.suffix == ".db":
                    if not _safe_copy_db(source, target):
                        raise ConversationBackupError(f"Could not snapshot database: {name}")
                else:
                    shutil.copyfile(source, target)
                target.chmod(0o600)
            manifest = {
                "format_version": FORMAT_VERSION, "protocol_version": 1,
                "snapshot_id": uuid.uuid4().hex, "source_root": str(root),
                "files": {name: _hash(staging / name) for name in sorted(members)},
                "database_schemas": {name: _schema(staging / name) for name in sorted(members) if name.endswith(".db")},
                "projection": _projection(staging),
            }
            (staging / MANIFEST_NAME).write_text(json.dumps(manifest, sort_keys=True, indent=2), encoding="utf-8")
            (staging / MANIFEST_NAME).chmod(0o600)
            verify_conversation_snapshot(staging)
        os.rename(staging, destination)
        return manifest
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def verify_conversation_snapshot(path: Path) -> dict:
    """Validate bytes and cross-database proofs using only the snapshot itself."""
    path = Path(path)
    try:
        manifest = json.loads(safe_member(path, MANIFEST_NAME).read_text(encoding="utf-8"))
        if manifest["format_version"] != FORMAT_VERSION or manifest["protocol_version"] != 1:
            raise ConversationBackupError("Unsupported conversation recovery format")
        for name, evidence in manifest["files"].items():
            member = safe_member(path, name)
            if _hash(member) != evidence:
                raise ConversationBackupError(f"Snapshot checksum mismatch: {name}")
            if member.suffix == ".db":
                if _schema(member) != manifest["database_schemas"][name]:
                    raise ConversationBackupError(f"Snapshot database schema differs: {name}")
                with closing(read_db(member)) as conn:
                    if [row[0] for row in conn.execute("PRAGMA integrity_check")] != ["ok"]:
                        raise ConversationBackupError(f"Snapshot database is corrupt: {name}")
        with closing(read_db(path / "shared-state.db")) as conn:
            required = _dependency_files(path, conn)
        if not required.issubset(manifest["files"]):
            raise ConversationBackupError("Snapshot omits required dependencies")
        if _projection(path) != manifest["projection"]:
            raise ConversationBackupError("Snapshot dependency projection differs from manifest")
        return manifest
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as exc:
        raise ConversationBackupError(f"Invalid conversation recovery set: {exc}") from exc


def _projection(root: Path) -> dict:
    from hermes_cli.conversation_backup_proofs import validate_projection
    return validate_projection(root)
