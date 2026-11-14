"""Recover pre-account desktop history through the existing authenticated importer.

Native code supplies the installation paths and imports these owner-bound batches;
this module never opens the live target or legacy database with a writer.
"""
from __future__ import annotations

import copy
import json
import sqlite3
import sys
import uuid

from hermes_cli.backup_sqlite import _safe_copy_db
from hermes_cli.desktop_history_recovery_batches import bounded_batches, filter_components, resolve_titles
from hermes_cli.desktop_history_recovery_reminders import filter_ignored, read_choices, record_choice, reminder_state
from hermes_cli.desktop_history_recovery_store import (
    apply_metadata, claim_unknown, discover_profiles, load_plan, metadata_snapshot,
    plain_path, private_dir, profile_home, prune_plans, snapshot_sessions, unknown_available, validate_request, write_json,
)

_RESPONSE_BUDGET = 110 * 1024 * 1024


def _target_snapshot(target, profile, directory):
    home = plain_path(profile_home(target, profile))
    if profile != "default":
        plain_path(target / "profiles")
    return snapshot_sessions(home, directory / f"target-{profile}-{uuid.uuid4().hex}.db")


def _inspect(source, target, owner, recovery):
    plan_id = uuid.uuid4().hex
    directory = private_dir(private_dir(recovery / "plans") / plan_id)
    groups = []
    references = []
    choices = read_choices(recovery, source, owner)
    counts = {"owned": 0, "unowned": 0, "foreign": 0, "conflicts": 0, "existing": 0, "deleted": 0, "oversized": 0}
    profiles = discover_profiles(source)
    for name, home in profiles:
        sessions, _ = snapshot_sessions(home, directory / f"source-{name}.db", include_groups=True)
        target_sessions, deleted = _target_snapshot(target, name, directory)
        components, profile_counts = filter_components(sessions, owner, target_sessions, deleted)
        components = _inspect_claims(components, home, owner, recovery, profile_counts)
        components = filter_ignored(components, name, choices, profile_counts)
        for component in components:
            _batches, oversized = bounded_batches([component["sessions"]])
            if oversized:
                profile_counts[component["ownership"]] -= oversized
                counts["oversized"] += oversized
            else:
                references.extend((name, row["id"]) for row in component["sessions"])
        for key, value in profile_counts.items():
            counts[key] += value
        if components:
            groups.append({"name": name, "components": components, "metadata": metadata_snapshot(home),
                           "target_existed": profile_home(target, name).exists()})
    data = {"owner": owner, "source": str(source), "target": str(target), "groups": groups,
            "counts": counts, "profiles": len(profiles), "reminder_refs": references}
    write_json(directory / "manifest.json", data)
    prune_plans(recovery, owner, source, target)
    return {"ok": True, "planId": plan_id, **counts, "profiles": len(profiles),
            "pending": counts["oversized"] + counts["conflicts"],
            **reminder_state(references, choices, source, owner)}


def _inspect_claims(components, home, owner, recovery, counts):
    accepted = []
    for component in components:
        if (component["ownership"] == "unowned"
                and not unknown_available(recovery, home / "state.db", component["sessions"], owner)):
            counts["unowned"] -= len(component["sessions"])
            continue
        accepted.append(component)
    return accepted


def _stamp_sessions(sessions, owner):
    result = copy.deepcopy(sessions)
    for session in result:
        config = session.get("model_config") or {}
        if isinstance(config, str):
            config = json.loads(config)
        session["model_config"] = {**config, "platform_owner": owner}
    return result


def _prepare_group(request, source, target, owner, recovery, directory, group):
    name = group["name"]
    target_sessions, deleted = _target_snapshot(target, name, directory)
    sessions = [session for component in group["components"] for session in component["sessions"]]
    components, counts = filter_components(sessions, owner, target_sessions, deleted)
    components = filter_ignored(components, name, read_choices(recovery, source, owner), counts)
    accepted, claimed_elsewhere = [], 0
    for component in components:
        unknown = component["ownership"] == "unowned"
        if unknown and request.get("confirm_unowned") is not True:
            continue
        rows = component["sessions"]
        if unknown and not claim_unknown(recovery, profile_home(source, name) / "state.db", rows, owner):
            claimed_elsewhere += len(rows)
            continue
        accepted.append(_stamp_sessions(rows, owner))
    # Resolve titles across every component before batching, not separately per batch.
    stamped = [session for component in accepted for session in component]
    titled = resolve_titles(stamped, target_sessions, group["metadata"], name)
    by_id = {session["id"]: session for session in titled}
    batches, oversized = bounded_batches([[by_id[session["id"]] for session in component] for component in accepted])
    return {"name": name, "batches": batches, "metadata": group["metadata"]}, {
        "claimedElsewhere": claimed_elsewhere, "oversized": oversized, "conflicts": counts["conflicts"],
        "unconfirmed": counts["unowned"] if request.get("confirm_unowned") is not True else 0,
        "deleted": counts["deleted"],
    }


def _prepare(request, source, target, owner, recovery, directory, plan):
    groups, used, remaining = [], 0, 0
    counts = {"claimedElsewhere": 0, "oversized": 0, "conflicts": 0, "unconfirmed": 0, "deleted": 0}
    for group in plan["groups"]:
        prepared, group_counts = _prepare_group(request, source, target, owner, recovery, directory, group)
        for key, count in group_counts.items():
            counts[key] += count
        accepted = []
        metadata_bytes = len(json.dumps(prepared["metadata"], ensure_ascii=False).encode("utf-8"))
        for batch in prepared["batches"]:
            size = len(json.dumps(batch, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            if used + size + (0 if accepted else metadata_bytes) > _RESPONSE_BUDGET:
                remaining += len(batch)
                continue
            accepted.append(batch)
            used += size + (metadata_bytes if len(accepted) == 1 else 0)
        if accepted:
            groups.append({**prepared, "batches": accepted})
    for key in ("conflicts", "oversized"):
        counts[key] = max(plan["counts"].get(key, 0), counts[key])
    return {"ok": True, "planId": request["plan_id"], "groups": groups, **counts,
            "more": remaining > 0, "remaining": remaining}


def _backup(request, target, directory):
    name = request.get("profile", "default")
    home = plain_path(profile_home(target, name))
    if name != "default":
        plain_path(target / "profiles")
    source = plain_path(home / "state.db")
    if not source.is_file():
        return {"ok": True, "backupPath": None}
    destination = private_dir(directory / "backups") / f"{name}-{uuid.uuid4().hex}.db"
    if not _safe_copy_db(source, destination):
        raise ValueError("could not back up target history")
    return {"ok": True, "backupPath": str(destination)}


def _metadata(request, target, plan):
    name = request.get("profile", "default")
    home = plain_path(profile_home(target, name))
    if request.get("created_profile") is not True or name == "default":
        return {"ok": True, "applied": False}
    plain_path(target / "profiles")
    group = next((group for group in plan["groups"] if group["name"] == name), None)
    if group is None or not home.is_dir():
        raise ValueError("recovery profile does not exist")
    if group["target_existed"]:
        return {"ok": True, "applied": False}
    return {"ok": True, "applied": apply_metadata(home, group["metadata"])}


def run(request):
    """Native-only JSON API; all account/path validation happens before data reads."""
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    source, _user_data, target, owner, recovery = validate_request(request)
    action = request.get("action")
    if action == "inspect":
        return _inspect(source, target, owner, recovery)
    directory, plan = load_plan(request, recovery, owner, source, target)
    if action == "remind":
        return record_choice(request, plan, recovery, source, owner)
    if action == "prepare":
        return _prepare(request, source, target, owner, recovery, directory, plan)
    if action == "backup":
        return _backup(request, target, directory)
    if action == "metadata":
        return _metadata(request, target, plan)
    raise ValueError("unknown history recovery action")


def main():
    try:
        request = json.load(sys.stdin)
        response = run(request)
    except (ValueError, OSError, KeyError, sqlite3.DatabaseError) as exc:
        print(json.dumps({"ok": False, "code": "history_recovery_failed", "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
