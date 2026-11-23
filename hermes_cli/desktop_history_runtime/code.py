"""Copy selected Code runtime/work files before the authenticated history import."""

from __future__ import annotations

import copy
from pathlib import Path

from hermes_cli.desktop_history_runtime.rollouts import discover, prepare as prepare_thread
from hermes_cli.desktop_history_runtime.workspaces import (
    SelectedSession, bind_lineages, prepare as prepare_workspace, remap_row,
)
from hermes_cli.desktop_history_runtime.files import Budget, checked, directory, homes, publish, regular


def migrate_code_files(source_home: Path, target_home: Path, sessions: list[dict]) -> tuple[list[dict], dict]:
    """Return independent rows and a JSON-serializable runtime manifest.

    Call ONLY after the caller's ownership/claim filters have approved these rows.
    Homes are absolute, non-overlapping profile roots without symlink components.
    Only ``code/{sessions,archived_sessions}`` for selected ``codex_thread_id``
    UUIDs and ``code/workspaces/<selected session id>`` are read/copied. Compressed
    descendants may share an approved ancestor's workspace and native thread.
    Explicit Work mode rows pass through unchanged. Known
    credential filenames and credential directories in workspaces are excluded;
    arbitrary user document contents are not classified or scrubbed.

    Nonempty row/config cwd and git_repo_root paths inside that session's own
    workspace are remapped. An empty row cwd retains projectless UI intent.
    Existing target files always win. Each new file is published atomically;
    failures may leave complete files that a retry reuses, never partial files.
    Selected archived source rollouts are placed in active dated sessions so
    Codex can resume them. An existing archived target thread requires unarchive.
    No credential, config, SQLite index, shared state or source file is written.

    Unsafe/corrupt/ambiguous inputs and resource limits raise ValueError; I/O
    errors propagate. No rows are returned on failure. Missing native rollouts
    are explicit manifest entries; the caller chooses its import policy.
    """
    source, target = homes(source_home, target_home)
    if not isinstance(sessions, list) or len(sessions) > 1_000:
        raise ValueError("selected session limit exceeded")
    rows = copy.deepcopy(sessions)
    parsed = [SelectedSession.parse(row) for row in rows]
    selected = bind_lineages([session for session in parsed if session.config.get("execution_mode") != "work"],
                             source, target)
    budget = Budget()
    unique_workspaces = {session.workspace_id: session for session in selected}
    workspace_plans = [plan for session in unique_workspaces.values()
                       if (plan := prepare_workspace(session, source, target, budget))]
    thread_sessions = _thread_sessions(selected)
    sources = discover(source, set(thread_sessions), budget)
    destinations = discover(target, set(thread_sessions), budget)
    thread_plans = [prepare_thread(thread, sources[thread], destinations[thread], source, target,
                                  tuple(source / "code/workspaces" / sid for sid in ancestors), budget)
                    for thread, ancestors in sorted(thread_sessions.items())]
    _preflight_targets(target, workspace_plans)
    manifest = {"threads": [], "workspaces": [], "copied_files": 0, "copied_bytes": 0}
    _publish_workspaces(source, target, workspace_plans, manifest)
    _publish_threads(source, target, thread_plans, manifest)
    for session in selected:
        remap_row(session, source, target)
    return rows, manifest


def _thread_sessions(selected):
    result = {}
    for session in selected:
        if session.thread_id:
            previous = result.get(session.thread_id, ())
            root = session.ancestors[-1]
            if previous and previous[-1] != root:
                raise ValueError("native thread shared across unrelated selected lineages")
            allowed = set(session.ancestors) | set(previous)
            result[session.thread_id] = (*sorted(allowed - {root}), root)
    return result


def _preflight_targets(target, plans):
    for plan in plans:
        for path in plan.directories:
            info = checked(target, path)
            if info is not None and not path.is_dir():
                raise ValueError("target workspace path is not a directory")
        for file in plan.files:
            if checked(target, file.destination) is not None:
                regular(target, file.destination, 512 * 1024 * 1024)


def _publish_workspaces(source, target, plans, manifest):
    for plan in plans:
        item = {"session_id": plan.session_id, "source": str(plan.source), "target": str(plan.target),
                "copied": 0, "existing": 0, "excluded": plan.excluded, "missing": plan.missing}
        for path in plan.directories:
            directory(target, path)
        for file in plan.files:
            copied = publish(source, target, file)
            item["copied" if copied else "existing"] += 1
            _count_copy(manifest, file.size, copied)
        manifest["workspaces"].append(item)


def _publish_threads(source, target, plans, manifest):
    for plan in plans:
        copied = False
        for file in plan.copies:
            did_copy = publish(source, target, file)
            copied |= did_copy
            _count_copy(manifest, file.size, did_copy)
        status = "existing" if plan.copies and not copied else plan.status
        manifest["threads"].append({"thread_id": plan.thread_id, "status": status,
                                    "paths": [str(path.relative_to(target)) for path in plan.paths]})


def _count_copy(manifest, size, copied):
    if copied:
        manifest["copied_files"] += 1
        manifest["copied_bytes"] += size
