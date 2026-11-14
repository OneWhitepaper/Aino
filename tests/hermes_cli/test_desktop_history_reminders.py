"""Only missing local history is offered, with durable account-scoped choices."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from hermes_state import SessionDB

OWNER = {"platform_origin": "https://api.aino.test", "user_id": "10"}


def _request(tmp_path, owner=OWNER):
    user_data = tmp_path / "desktop"
    encoded = json.dumps(list(owner.values()), separators=(",", ":")).encode()
    key = hashlib.sha256(encoded).hexdigest()
    return {"action": "inspect", "source_home": str(tmp_path / "legacy"), "user_data": str(user_data),
            "target_home": str(user_data / "account-workspaces" / key / "home"), "owner": owner}


def _seed(home, *ids, owner=None):
    home.mkdir(parents=True, exist_ok=True)
    db = SessionDB(db_path=home / "state.db")
    for sid in ids:
        row = {"id": sid, "source": "desktop", "messages": [{"role": "user", "content": sid}]}
        if owner is not None:
            row["model_config"] = {"platform_owner": owner}
        assert db.import_sessions([row])["ok"]
    db.close()


def test_reminder_is_absent_when_history_is_already_present_or_only_foreign(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = Path(request["source_home"])
    assert run(request)["showReminder"] is False
    _seed(source, "present", owner=OWNER)
    _seed(source, "foreign", owner={**OWNER, "user_id": "other"})
    _seed(Path(request["target_home"]), "present", owner=OWNER)
    inspected = run(request)
    assert inspected["owned"] == inspected["unowned"] == 0
    assert inspected["showReminder"] is False
    assert inspected["snoozedUntil"] is None


def test_ignore_is_persisted_for_this_batch_without_deleting_or_claiming_records(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = Path(request["source_home"])
    _seed(source, "old-unknown")
    original = (source / "state.db").read_bytes()
    first = run(request)
    assert first["showReminder"] is True and first["unowned"] == 1
    decision = run({**request, "action": "remind", "plan_id": first["planId"], "choice": "ignore"})
    assert decision["showReminder"] is False
    again = run(request)
    assert again["owned"] == again["unowned"] == 0 and again["showReminder"] is False
    assert (source / "state.db").read_bytes() == original
    assert not (Path(request["target_home"]) / "state.db").exists()
    other = run(_request(tmp_path, {**OWNER, "user_id": "second"}))
    assert other["unowned"] == 1 and other["showReminder"] is True
    _seed(source, "newly-discovered")
    future = run(request)
    assert future["unowned"] == 1 and future["showReminder"] is True
    assert future["reminderKey"] != first["reminderKey"]
    # A stale window cannot restore the batch another window just chose to ignore.
    stale = run({**request, "action": "prepare", "plan_id": first["planId"], "confirm_unowned": True})
    assert not stale["groups"]


def test_later_snoozes_this_batch_across_inspections_without_blocking_new_history(tmp_path, monkeypatch):
    from hermes_cli.desktop_history_recovery import run
    from hermes_cli import desktop_history_recovery_reminders as reminders

    now = 1_800_000_000.0
    monkeypatch.setattr(reminders.time, "time", lambda: now)
    request = _request(tmp_path)
    _seed(Path(request["source_home"]), "old", owner=OWNER)
    first = run(request)
    second = run(request)
    assert first["planId"] != second["planId"] and first["reminderKey"] == second["reminderKey"]
    choice = run({**request, "action": "remind", "plan_id": first["planId"], "choice": "later"})
    assert choice["snoozedUntil"] == (now + 24 * 60 * 60) * 1000
    snoozed = run(request)
    assert snoozed["owned"] == 1 and snoozed["showReminder"] is False
    assert snoozed["snoozedUntil"] == choice["snoozedUntil"]
    monkeypatch.setattr(reminders.time, "time", lambda: now + 24 * 60 * 60 + 1)
    assert run(request)["showReminder"] is True
    monkeypatch.setattr(reminders.time, "time", lambda: now)
    _seed(Path(request["source_home"]), "new", owner=OWNER)
    assert run(request)["showReminder"] is True


def test_stale_later_cannot_undo_ignore_and_foreign_plan_cannot_change_choices(tmp_path):
    import pytest
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    _seed(Path(request["source_home"]), "old", owner=OWNER)
    first = run(request)
    run({**request, "action": "remind", "plan_id": first["planId"], "choice": "ignore"})
    run({**request, "action": "remind", "plan_id": first["planId"], "choice": "later"})
    assert run(request)["showReminder"] is False
    other = _request(tmp_path, {**OWNER, "user_id": "second"})
    with pytest.raises(ValueError, match="owner"):
        run({**other, "action": "remind", "plan_id": first["planId"], "choice": "ignore"})
    with pytest.raises(ValueError, match="choice"):
        run({**request, "action": "remind", "plan_id": first["planId"], "choice": "delete"})


def test_ignore_does_not_match_a_different_profile_source_or_platform_origin(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = Path(request["source_home"])
    _seed(source, "same-id")
    first = run(request)
    run({**request, "action": "remind", "plan_id": first["planId"], "choice": "ignore"})
    _seed(source / "profiles" / "writer", "same-id")
    assert run(request)["unowned"] == 1
    other_source = {**request, "source_home": str(tmp_path / "second-legacy")}
    _seed(Path(other_source["source_home"]), "same-id")
    assert run(other_source)["unowned"] == 1
    other_origin = _request(tmp_path, {**OWNER, "platform_origin": "https://other.aino.test"})
    assert run(other_origin)["unowned"] == 2


def test_owned_only_restore_rekeys_remaining_unknown_history_without_skipping_confirmation(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = Path(request["source_home"])
    _seed(source, "mine", owner=OWNER)
    _seed(source, "unknown")
    before = run(request)
    prepared = run({**request, "action": "prepare", "plan_id": before["planId"], "confirm_unowned": False})
    rows = [row for group in prepared["groups"] for batch in group["batches"] for row in batch]
    assert [row["id"] for row in rows] == ["mine"]
    target = Path(request["target_home"])
    target.mkdir(parents=True, exist_ok=True)
    db = SessionDB(db_path=target / "state.db")
    assert db.import_sessions(rows)["ok"]
    db.close()
    after = run(request)
    assert after["owned"] == 0 and after["unowned"] == 1 and after["showReminder"]
    assert after["reminderKey"] != before["reminderKey"]
    still_unconfirmed = run({**request, "action": "prepare", "plan_id": after["planId"], "confirm_unowned": False})
    assert not still_unconfirmed["groups"]
