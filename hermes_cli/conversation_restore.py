"""Staged, journaled installation of a verified conversation recovery set."""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from contextlib import ExitStack, closing
from pathlib import Path

from hermes_cli.conversation_backup import (
    ConversationBackupError, MANIFEST_NAME, profile_relative_home, rows, safe_member,
    shared_root, verify_conversation_snapshot,
)

JOURNAL_NAME = ".conversation-restore.json"


def _journal(root, value):
    from utils import atomic_write_text
    atomic_write_text(root / JOURNAL_NAME, json.dumps(value, sort_keys=True),
                      mode=0o600, fsync_dir=True)


def _require_offline(paths):
    """A restore replaces whole Profile DBs; every existing holder must be offline."""
    paths = [path for path in paths if path.exists()]
    if not paths:
        return
    watched = {str(path.resolve()) + suffix for path in paths for suffix in ("", "-wal", "-shm", "-journal")}
    # SessionDB intentionally retains read-only header-probe descriptors for the
    # process lifetime. They cannot publish cached rows and must not be closed.
    from hermes_state_dbfile import _HEADER_PROBE_FDS, _HEADER_PROBE_LOCK
    with _HEADER_PROBE_LOCK:
        probes = {record[0] for record in _HEADER_PROBE_FDS.values()}
    # Reuse the native descriptor inventory also used to detect retired WAL
    # holders. macOS psutil.open_files fails on unrelated protected processes.
    if sys.platform == "darwin":
        from hermes_state_dbfile import _iter_darwin_fd_targets
        targets = (target for pid, fd, target, _ in _iter_darwin_fd_targets()
                   if pid != os.getpid() or fd not in probes)
    elif sys.platform.startswith("linux"):
        from hermes_state_dbfile import _iter_proc_fd_targets
        targets = (target for pid, target, descriptor in _iter_proc_fd_targets()
                   if pid != os.getpid() or int(Path(descriptor).name) not in probes)
    else:
        targets = _other_host_files()
    held = {str(Path(target).resolve()) for target in targets} & watched
    if held:
        raise ConversationBackupError("Close processes holding the recovery databases before restoring: " + ", ".join(sorted(held)))


def _other_host_files():
    import psutil
    for process in psutil.process_iter(["pid", "uids"]):
        try:
            if hasattr(os, "getuid") and process.info.get("uids") and process.info["uids"].real != os.getuid():
                continue
            yield from (item.path for item in process.open_files())
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied as exc:
            raise ConversationBackupError("Cannot verify that recovery databases are offline") from exc


def _sanitize(staging, manifest, target_root):
    source_root = Path(manifest["source_root"])
    with closing(sqlite3.connect(staging / "shared-state.db")) as conn:
        conn.row_factory = sqlite3.Row
        ids = [r["conversation_id"] for r in rows(conn, "hosted_room_conversations")]
        placeholders = ",".join("?" for _ in ids)
        now = time.time()
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "hosted_room_driver_leases" in tables:
            conn.execute("UPDATE hosted_room_driver_leases SET expires_at=0,released_at=?,lease_generation=lease_generation+1", (now,))
        if "hosted_room_driver_tasks" in tables:
            conn.execute(f"""UPDATE hosted_room_driver_tasks SET status='indeterminate',
                execution_generation=execution_generation+1,cancel_generation=cancel_generation+1,
                run_gateway_id=NULL,run_process_generation=NULL,run_lease_generation=NULL,
                result_json=?,indeterminate_at=?,updated_at=?
                WHERE status IN ('queued','running','stopping','deferred','indeterminate')""",
                (json.dumps({"error": "restored_snapshot_requires_stop"}), now, now))
        # The shared DB also carries discussion routes. History is restorable;
        # inbound reservations and outbound signed grants are not fresh consent.
        conn.execute("UPDATE hosted_room_peer_reservations SET revoked_at=?,expires_at=0,updated_at=?", (now, now))
        conn.execute("UPDATE hosted_room_links SET grant='',status='needs_reauthorization',updated_at=?", (now,))
        if "hosted_conversation_background_origins" in tables:
            conn.execute("UPDATE hosted_conversation_background_origins SET state='interrupted',owner_pid=0,owner_started=0 "
                         "WHERE state='pending'")
            conn.execute("UPDATE hosted_conversation_notifications SET state='cancelled' WHERE state='queued'")
        if "hosted_conversation_command_tokens" in tables:
            conn.execute("DELETE FROM hosted_conversation_command_tokens WHERE consumed_input_id IS NULL")
        # Old generations remain immutable evidence. A future turn prepares a new
        # Profile agent and obtains fresh execution authorization at its normal seam.
        conn.execute("UPDATE hosted_room_conversation_participants SET session_generation=session_generation+1,lineage_id=NULL")
        conn.execute(f"UPDATE hosted_rooms SET revision=revision+1,updated_at=? WHERE room_id IN ({placeholders})", (now, *ids))
        for runtime in rows(conn, "hosted_room_conversation_runtimes"):
            home = target_root / profile_relative_home(runtime["profile"])
            old_home = source_root / profile_relative_home(runtime["profile"])
            cwd = str(home) if Path(runtime["cwd"]) == old_home else runtime["cwd"]
            conn.execute("""UPDATE hosted_room_conversation_runtimes SET profile_home=?,cwd=?
                WHERE conversation_id=? AND participant_id=? AND session_generation=?""",
                (str(home), cwd, runtime["conversation_id"], runtime["participant_id"], runtime["session_generation"]))
        conn.commit()
    by_profile = {}
    for lineage in manifest["projection"]["lineages"]:
        by_profile.setdefault(lineage["profile"], set()).update(lineage["ancestors"])
    for profile, sessions in by_profile.items():
        with closing(sqlite3.connect(staging / profile_relative_home(profile) / "state.db")) as conn:
            for sid in sessions:
                conn.execute("DELETE FROM session_turn_leases WHERE conversation_id=?", (sid,))
                conn.execute("DELETE FROM compression_locks WHERE session_id=?", (sid,))
            conn.commit()


def _install_files(source, root, names):
    from hermes_cli.backup import _safe_restore_db
    for name in names:
        src, dst = safe_member(source, name), safe_member(root, name)
        dst.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if dst.suffix == ".db":
            if not _safe_restore_db(src, dst):
                raise ConversationBackupError(f"Could not restore database: {name}")
        else:
            temporary = dst.with_name("." + dst.name + ".restore")
            shutil.copyfile(src, temporary)
            temporary.chmod(0o600)
            os.replace(temporary, dst)


def restore_conversation_snapshot(snapshot: Path, root: Path, *, timeout=30.0) -> dict:
    """Restore offline databases as one journaled set; failure restores original bytes."""
    from gateway.hosted_room_conversation_maintenance import snapshot_operation
    from hermes_cli.backup import _safe_copy_db
    from hermes_cli.sqlite_safe_read import offline_file_access

    snapshot, root = Path(snapshot), Path(root).resolve()
    if root != shared_root(root):
        raise ConversationBackupError("Conversation recovery requires the installation root")
    manifest = verify_conversation_snapshot(snapshot)
    root.mkdir(parents=True, exist_ok=True)
    names = sorted(manifest["files"], key=lambda name: (name == "shared-state.db", name))
    with snapshot_operation(root, timeout=timeout), ExitStack() as stack:
        if (root / JOURNAL_NAME).exists():
            # Repeating the user's existing import/snapshot command is the
            # recovery entry point; never expose a half-installed set first.
            recover_interrupted_conversation_restore(root, timeout=timeout)
        identity = root / "install_id"
        if identity.exists() and identity.read_text(encoding="utf-8").strip() != manifest["projection"]["install_id"]:
            raise ConversationBackupError("Restore destination belongs to a different installation")
        work = Path(tempfile.mkdtemp(prefix=".conversation-restore-", dir=root))
        staged, rollback = work / "staged", work / "rollback"
        shutil.copytree(snapshot, staged)
        rollback.mkdir(mode=0o700)
        _sanitize(staged, manifest, root)
        before = [name for name in names if safe_member(root, name).exists()]
        state = {"version": 1, "work": work.name, "files": names, "before": before, "phase": "preflight"}
        _journal(root, state)
        installed = False
        try:
            databases = [safe_member(root, name) for name in names if name.endswith(".db")]
            for path in databases:
                stack.enter_context(offline_file_access(path, what="conversation restore"))
            _require_offline(databases)
            for name in before:
                src, dst = safe_member(root, name), safe_member(rollback, name)
                dst.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if src.suffix == ".db":
                    if not _safe_copy_db(src, dst):
                        raise ConversationBackupError(f"Could not preserve original database: {name}")
                else:
                    shutil.copyfile(src, dst)
                dst.chmod(0o600)
            state["phase"] = "installing"
            _journal(root, state)
            installed = True
            _install_files(staged, root, names)
            state["phase"] = "complete"
            _journal(root, state)
        except BaseException:
            if installed:
                _rollback(root, state)
            (root / JOURNAL_NAME).unlink()
            shutil.rmtree(work)
            raise
        (root / JOURNAL_NAME).unlink()
        shutil.rmtree(work)
    return manifest


def _rollback(root, state):
    rollback = safe_member(root, state["work"]) / "rollback"
    _install_files(rollback, root, state["before"])
    for name in set(state["files"]) - set(state["before"]):
        path = safe_member(root, name)
        path.unlink(missing_ok=True)
        if path.suffix == ".db":
            for suffix in ("-wal", "-shm", "-journal"):
                path.with_name(path.name + suffix).unlink(missing_ok=True)


def recover_interrupted_conversation_restore(root: Path, *, timeout=30.0) -> None:
    """Rollback an interrupted install before allowing managed runtimes to reopen."""
    from gateway.hosted_room_conversation_maintenance import snapshot_operation
    from hermes_cli.sqlite_safe_read import offline_file_access
    root = Path(root).resolve()
    with snapshot_operation(root, timeout=timeout), ExitStack() as stack:
        path = root / JOURNAL_NAME
        state = json.loads(path.read_text(encoding="utf-8"))
        if state.get("version") != 1 or not state["work"].startswith(".conversation-restore-"):
            raise ConversationBackupError("Invalid interrupted restore journal")
        databases = [safe_member(root, name) for name in state["files"] if name.endswith(".db")]
        for database in databases:
            stack.enter_context(offline_file_access(database, what="restore recovery"))
        _require_offline(databases)
        if state["phase"] == "installing":
            _rollback(root, state)
        elif state["phase"] not in ("preflight", "complete"):
            raise ConversationBackupError("Unknown interrupted restore phase")
        path.unlink()
        shutil.rmtree(safe_member(root, state["work"]))
