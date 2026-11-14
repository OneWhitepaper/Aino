"""Durable reminder choices for one account's missing local history batch."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from contextlib import closing

from hermes_cli.desktop_history_recovery_store import plain_path

_SNOOZE_SECONDS = 24 * 60 * 60
_TABLE = "desktop_history_reminders"


def _scope(owner, source):
    stamp = json.dumps(owner, sort_keys=True, separators=(",", ":"))
    source_key = hashlib.sha256(str(source).encode("utf-8")).hexdigest()
    return stamp, source_key


def read_choices(recovery, source, owner):
    """Inspection never creates a ledger and never modifies a past user choice."""
    path = plain_path(recovery / "claims.db")
    if not path.is_file():
        return {}
    stamp, source_key = _scope(owner, source)
    with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (_TABLE,)).fetchone():
            return {}
        return {(row[0], row[1]): (row[2], row[3]) for row in connection.execute(
            f"SELECT profile,session,choice,until FROM {_TABLE} WHERE owner=? AND source=?", (stamp, source_key))}


def filter_ignored(components, profile, choices, counts):
    retained = []
    for component in components:
        if any(choices.get((profile, row["id"]), (None,))[0] == "ignore" for row in component["sessions"]):
            counts[component["ownership"]] -= len(component["sessions"])
            continue
        retained.append(component)
    return retained


def reminder_state(references, choices, source, owner):
    references = sorted(set(tuple(reference) for reference in references))
    stamp, source_key = _scope(owner, source)
    encoded = json.dumps([stamp, source_key, references], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    key = hashlib.sha256(encoded).hexdigest()
    now = time.time() * 1000
    due_times = [choices.get(reference, ("later", 0))[1] or 0 for reference in references]
    show = bool(due_times) and min(due_times) <= now
    return {"reminderKey": key, "showReminder": show,
            "snoozedUntil": min(due_times) if due_times and not show else None}


def record_choice(request, plan, recovery, source, owner):
    choice = request.get("choice")
    if choice not in {"later", "ignore"}:
        raise ValueError("invalid reminder choice")
    references = plan.get("reminder_refs", [])
    stamp, source_key = _scope(owner, source)
    until = (time.time() + _SNOOZE_SECONDS) * 1000 if choice == "later" else None
    if references:
        path = plain_path(recovery / "claims.db")
        descriptor = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(descriptor)
        with closing(sqlite3.connect(path, timeout=10)) as connection, connection:
            # Share the existing claim ledger; an ignore never claims unknown history.
            connection.execute("CREATE TABLE IF NOT EXISTS claims (source TEXT, session TEXT, owner TEXT, PRIMARY KEY(source, session))")
            connection.execute(f"""CREATE TABLE IF NOT EXISTS {_TABLE} (
                owner TEXT NOT NULL, source TEXT NOT NULL, profile TEXT NOT NULL, session TEXT NOT NULL,
                choice TEXT NOT NULL CHECK(choice IN ('later','ignore')), until REAL,
                PRIMARY KEY(owner,source,profile,session))""")
            connection.executemany(f"""INSERT INTO {_TABLE} VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner,source,profile,session) DO UPDATE SET
                choice=CASE WHEN {_TABLE}.choice='ignore' THEN 'ignore' ELSE excluded.choice END,
                until=CASE WHEN {_TABLE}.choice='ignore' THEN NULL ELSE excluded.until END""",
                [(stamp, source_key, profile, sid, choice, until) for profile, sid in references])
    state = reminder_state(references, read_choices(recovery, source, owner), source, owner)
    return {"ok": True, **state, "showReminder": False}
