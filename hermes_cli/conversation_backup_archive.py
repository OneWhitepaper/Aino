"""Existing quick/full backup adapters for the same verified recovery set."""
from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import tempfile

from hermes_cli.conversation_backup import (
    ConversationBackupError, MANIFEST_NAME, create_conversation_snapshot, has_conversations,
    safe_member, shared_root, verify_conversation_snapshot,
)

RECOVERY_DIRECTORY = ".conversation-recovery"


@contextmanager
def staged_recovery(home):
    root = shared_root(home)
    if not has_conversations(root):
        yield None
        return
    with tempfile.TemporaryDirectory(prefix="hermes-conversation-backup-") as temporary:
        destination = Path(temporary) / RECOVERY_DIRECTORY
        create_conversation_snapshot(root, destination)
        yield destination


def without_recovery_files(files, home, recovery):
    if recovery is None:
        return files
    manifest = json.loads((recovery / MANIFEST_NAME).read_text(encoding="utf-8"))
    root = shared_root(home)
    replaced = {(root / name).resolve() for name in manifest["files"]}
    return [(path, relative) for path, relative in files if path.resolve() not in replaced]


def write_recovery_zip(archive, recovery):
    if recovery is None:
        return 0
    manifest = verify_conversation_snapshot(recovery)
    names = [*manifest["files"], MANIFEST_NAME]
    for name in names:
        archive.write(recovery / name, arcname=f"{RECOVERY_DIRECTORY}/{name}")
    return sum((recovery / name).stat().st_size for name in names)


def stage_quick_recovery(home, staging):
    if not has_conversations(shared_root(home)):
        return {}
    destination = staging / RECOVERY_DIRECTORY
    manifest = create_conversation_snapshot(shared_root(home), destination)
    return {f"{RECOVERY_DIRECTORY}/{name}": (destination / name).stat().st_size
            for name in (*manifest["files"], MANIFEST_NAME)}


def restore_zip_recovery(archive, members, prefix, root):
    recovery_prefix = prefix + RECOVERY_DIRECTORY + "/"
    manifest_member = recovery_prefix + MANIFEST_NAME
    if manifest_member not in members:
        return set()
    if Path(root).resolve() != shared_root(root):
        raise ConversationBackupError("Restore this conversation backup from the installation root")
    from hermes_cli.conversation_restore import restore_conversation_snapshot
    with tempfile.TemporaryDirectory(prefix="hermes-conversation-import-") as temporary:
        staging = Path(temporary)
        manifest = json.loads(archive.read(manifest_member))
        for name in (*manifest["files"], MANIFEST_NAME):
            target = safe_member(staging, name)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.open(recovery_prefix + name) as source, target.open("xb") as destination:
                shutil.copyfileobj(source, destination)
            target.chmod(0o600)
        restore_conversation_snapshot(staging, root)
    return set(manifest["files"])


def restore_quick_recovery(snapshot, home):
    path = snapshot / RECOVERY_DIRECTORY
    if not (path / MANIFEST_NAME).is_file():
        return set()
    from hermes_cli.conversation_restore import restore_conversation_snapshot
    root = shared_root(home)
    manifest = restore_conversation_snapshot(path, root)
    return {(root / name).resolve() for name in manifest["files"]}
