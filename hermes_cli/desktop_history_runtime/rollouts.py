"""Select native rollout files by UUID and verify every session_meta before copying."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
import os
from pathlib import Path
import re
import stat

from hermes_cli.desktop_history_runtime.files import Budget, CopyFile, checked, reader, regular
from hermes_cli.desktop_history_runtime.workspaces import remap


@dataclass(frozen=True)
class ThreadFiles:
    thread_id: str
    copies: tuple[CopyFile, ...]
    paths: tuple[Path, ...]
    status: str


def discover(home: Path, selected: set[str], budget: Budget):
    found = {thread: [] for thread in selected}
    if not selected:
        return found
    for name in ("sessions", "archived_sessions"):
        root = home / "code" / name
        if checked(home, root) is not None:
            _scan(home, root, selected, found, budget)
    return found


def _scan(home, root, selected, found, budget):
    pending = [(root, 0)]
    while pending:
        current, depth = pending.pop()
        checked(home, current)
        with os.scandir(current) as entries:
            for entry in entries:
                budget.visit()
                path = Path(entry.path)
                match = re.fullmatch(r"rollout-[0-9T:-]+-([0-9a-fA-F-]{36})\.jsonl", entry.name)
                if match and match[1].lower() in selected:
                    regular(home, path, 128 * 1024 * 1024)
                    found[match[1].lower()].append(path)
                elif depth < 3 and re.fullmatch(r"\d{4}" if depth == 0 else r"\d{2}", entry.name):
                    info = checked(home, path)
                    if stat.S_ISDIR(info.st_mode):
                        pending.append((path, depth + 1))


def prepare(thread, sources, destinations, source, target, workspace, budget):
    validated = []
    for path in sorted(sources):
        info = regular(source, path, 128 * 1024 * 1024)
        budget.reserve(info.st_size)
        blob = _validated(source, path, thread, source, target, workspace)
        destination = target / path.relative_to(source)
        if path.is_relative_to(source / "code/archived_sessions"):
            day = date.fromisoformat(path.name[8:18])
            destination = target / "code/sessions" / f"{day:%Y/%m/%d}" / path.name
        validated.append(CopyFile(path, destination, len(blob), info.st_mtime_ns, blob))
    if destinations:
        if any(path.is_relative_to(target / "code/archived_sessions") for path in destinations):
            raise ValueError("existing target native thread is archived; unarchive before recovery")
        for path in sorted(destinations):
            # Existing target state is authoritative, including an archive/unarchive
            # that moved the rollout to a different date or directory.
            info = regular(target, path, 128 * 1024 * 1024)
            budget.reserve(info.st_size)
            _validated(target, path, thread, source, target, workspace)
        return ThreadFiles(thread, (), tuple(sorted(destinations)), "existing")
    if len(validated) > 1:
        raise ValueError("ambiguous duplicate native thread rollouts")
    return ThreadFiles(thread, tuple(validated), tuple(plan.destination for plan in validated),
                       "copied" if validated else "missing")


def _validated(home, path, thread, source, target, workspace):
    output, seen, total, output_size = [], False, 0, 0
    # A crash after link publication may leave both the complete destination
    # and its temporary name. UUID validation still applies on every retry.
    with reader(home, path, 128 * 1024 * 1024, reject_hardlinks=False) as handle:
        while line := handle.readline(8 * 1024 * 1024 + 1):
            total += len(line)
            if len(line) > 8 * 1024 * 1024 or total > 128 * 1024 * 1024:
                raise ValueError("rollout line/byte limit exceeded")
            if not line.strip():
                output.append(line)
                output_size += len(line)
                continue
            try:
                record = json.loads(line)
            except (ValueError, UnicodeError) as exc:
                raise ValueError("invalid native rollout JSON") from exc
            seen, changed = _record(record, thread, seen, source, target, workspace)
            blob = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8") if changed else line
            output_size += len(blob)
            if output_size > 128 * 1024 * 1024:
                raise ValueError("remapped rollout size limit exceeded")
            output.append(blob)
    if not seen:
        raise ValueError("rollout has no session_meta identity")
    return b"".join(output)


def _record(record, thread, seen, source, target, workspace):
    if not isinstance(record, dict):
        raise ValueError("native rollout record must be an object")
    kind, payload = record.get("type"), record.get("payload")
    if kind == "session_meta":
        if not isinstance(payload, dict) or payload.get("id") != thread:
            raise ValueError("rollout session_meta thread identity mismatch")
        seen = True
    elif not seen:
        raise ValueError("native rollout must start with session_meta")
    changed = False
    if kind in {"session_meta", "turn_context"} and isinstance(payload, dict) and "cwd" in payload:
        value = payload["cwd"]
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError("invalid native rollout cwd path")
        mapped = remap(value, source, target, workspace)
        changed = value != mapped
        payload["cwd"] = mapped
    return seen, changed
