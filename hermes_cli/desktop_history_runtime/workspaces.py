"""Recover only the selected session's projectless directory and structured paths."""

from __future__ import annotations

from dataclasses import dataclass, replace
import json
import os
from pathlib import Path
import stat
from uuid import UUID

from hermes_cli.desktop_history_runtime.files import Budget, CopyFile, checked, regular
from hermes_cli.profiles import profile_path_is_private


@dataclass(frozen=True)
class SelectedSession:
    row: dict
    config: dict
    encoded_config: bool
    session_id: str
    thread_id: str | None
    workspace_id: str
    ancestors: tuple[str, ...]

    @classmethod
    def parse(cls, row):
        if not isinstance(row, dict):
            raise ValueError("selected session must be an object")
        sid = row.get("id")
        if (not isinstance(sid, str) or not sid or len(sid) > 200 or sid in {".", ".."}
                or any(character in sid for character in ("/", "\\", "\0"))):
            raise ValueError("invalid selected session id")
        raw = row.get("model_config")
        encoded = isinstance(raw, str)
        config = json.loads(raw) if encoded else raw
        config = {} if config is None else config
        if not isinstance(config, dict):
            raise ValueError("session model_config must be an object")
        thread = config.get("codex_thread_id") if config.get("execution_mode") != "work" else None
        if "codex_thread_id" in config and thread is not None:
            thread = _thread_id(thread)
        for value in (row.get("cwd"), config.get("cwd"), row.get("git_repo_root"), config.get("git_repo_root")):
            if value is not None and (not isinstance(value, str) or (value and not Path(value).is_absolute())):
                raise ValueError("session workspace path must be absolute")
        return cls(row, config, encoded, sid, thread, sid, (sid,))


def _thread_id(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value.lower():
            raise ValueError("noncanonical UUID")
    except ValueError as exc:
        raise ValueError("invalid Codex thread UUID") from exc
    return value.lower()


def bind_lineages(selected: list[SelectedSession], source: Path, target: Path):
    by_id = {session.session_id: session for session in selected}
    if len(by_id) != len(selected):
        raise ValueError("duplicate selected session id")
    result = []
    for session in selected:
        ancestors = _ancestors(session, by_id)
        allowed = tuple(source / "code/workspaces" / sid for sid in ancestors)
        owners = set()
        for container in (session.row, session.config):
            for key in ("cwd", "git_repo_root"):
                value = container.get(key)
                mapped = remap(value, source, target, allowed)
                if value != mapped:
                    owners.add(Path(value).relative_to(source / "code/workspaces").parts[0])
        if len(owners) > 1:
            raise ValueError("ambiguous workspace roots in selected lineage")
        owner = next(iter(owners), session.session_id)
        result.append(replace(session, workspace_id=owner, ancestors=ancestors))
    return result


def _ancestors(session, by_id):
    chain = []
    current = session
    while current is not None:
        if current.session_id in chain:
            raise ValueError("cyclic selected session lineage")
        chain.append(current.session_id)
        parent = current.row.get("parent_session_id")
        if parent is not None and not isinstance(parent, str):
            raise ValueError("invalid selected parent lineage")
        current = by_id.get(parent)
    return tuple(chain)


@dataclass(frozen=True)
class Workspace:
    session_id: str
    source: Path
    target: Path
    files: tuple[CopyFile, ...]
    directories: tuple[Path, ...]
    excluded: int
    missing: bool


def remap(value, source: Path, target: Path, allowed: tuple[Path, ...]):
    if not value:
        return value
    path = Path(value)
    if not path.is_relative_to(source / "code/workspaces"):
        return value
    if ".." in path.parts or not any(path.is_relative_to(workspace) for workspace in allowed):
        raise ValueError("path references another session's workspace")
    checked(source, path)
    return str(target / path.relative_to(source))


def prepare(session: SelectedSession, source: Path, target: Path, budget: Budget):
    workspace = source / "code/workspaces" / session.workspace_id
    allowed = tuple(source / "code/workspaces" / sid for sid in session.ancestors)
    refs = (session.row.get("cwd"), session.config.get("cwd"), session.row.get("git_repo_root"),
            session.config.get("git_repo_root"))
    mapped = [remap(value, source, target, allowed) for value in refs]
    referenced = list(refs) != mapped
    cwd = session.config.get("cwd") or session.row.get("cwd")
    inferred = (not cwd and (session.thread_id or session.config.get("execution_mode") == "code")
                and checked(source, workspace) is not None)
    if not referenced and not inferred:
        return None
    info = checked(source, workspace)
    destination = target / workspace.relative_to(source)
    if info is None:
        return Workspace(session.workspace_id, workspace, destination, (), (destination,), 0, True)
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("session workspace is not a directory")
    files, directories, excluded = _inventory(source, target, workspace, budget)
    return Workspace(session.workspace_id, workspace, destination, tuple(files), tuple(directories), excluded, False)


def _excluded(relative):
    parts = relative.parts
    if any(profile_path_is_private(parts[index:]) for index in range(len(parts))):
        return True
    lower = relative.name.lower()
    return (lower in {"config.toml", "credentials", "credentials.json", "credentials.yaml",
                      "credentials.yml", "secrets.json", "secrets.yaml", "secrets.yml",
                      ".codex", ".hermes", ".aino", ".git", ".npmrc", ".netrc",
                      "replay.key", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"}
            or lower.startswith(".env") or lower.endswith((".pem", ".key", ".p12", ".pfx", ".keystore", ".kdbx")))


def _inventory(source, target, workspace, budget):
    pending, files, directories, excluded = [(workspace, 0)], [], [], 0
    while pending:
        current, depth = pending.pop()
        if depth > 32:
            raise ValueError("workspace depth limit exceeded")
        checked(source, current)
        directories.append(target / current.relative_to(source))
        with os.scandir(current) as entries:
            for entry in entries:
                budget.visit()
                if _excluded(Path(entry.path).relative_to(workspace)):
                    excluded += 1
                    continue
                path = Path(entry.path)
                info = checked(source, path)
                if stat.S_ISDIR(info.st_mode):
                    pending.append((path, depth + 1))
                    continue
                info = regular(source, path, 64 * 1024 * 1024, reject_hardlinks=True)
                budget.reserve(info.st_size)
                files.append(CopyFile(path, target / path.relative_to(source), info.st_size, info.st_mtime_ns))
    return files, directories, excluded


def remap_row(session: SelectedSession, source, target):
    allowed = tuple(source / "code/workspaces" / sid for sid in session.ancestors)
    for container in (session.row, session.config):
        for key in ("cwd", "git_repo_root"):
            if key in container:
                container[key] = remap(container[key], source, target, allowed)
    if "model_config" in session.row:
        session.row["model_config"] = json.dumps(session.config, ensure_ascii=False) if session.encoded_config else session.config
