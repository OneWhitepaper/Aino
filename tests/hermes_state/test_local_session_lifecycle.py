"""Local history remains durable, portable and isolated during desktop changes."""

import json
import time

from hermes_state import SessionDB


def _contents(db, session_id):
    return [message["content"] for message in db.get_messages(session_id)]


def test_local_history_round_trip_preserves_existing_attachments_and_account_isolation(tmp_path):
    first, second, restored = (tmp_path / name for name in ("first-account", "second-account", "restored"))
    for home in (first, second, restored):
        home.mkdir()
    attachment = first / "cloud-sync" / "media" / "existing.png"
    attachment.parent.mkdir(parents=True)
    attachment.write_bytes(b"existing local attachment")
    content = f"Existing attachment: ![image]({attachment})"
    with SessionDB(first / "state.db") as db:
        db.create_session("conversation", source="desktop")
        db.append_message("conversation", "user", content)

    with (SessionDB(first / "state.db") as local,
          SessionDB(second / "state.db") as other,
          SessionDB(restored / "state.db") as destination):
        assert _contents(local, "conversation") == [content]
        local.append_message("conversation", "assistant", "Saved after reopening")
        other.create_session("conversation", source="desktop")
        other.append_message("conversation", "user", "Another account's local history")
        payload = json.loads(json.dumps(local.export_session("conversation", include_inactive=True)))
        result = destination.import_sessions([payload])
        assert result["ok"] and result["imported"] == 1, result
        assert _contents(destination, "conversation") == [content, "Saved after reopening"]
        assert destination.set_session_archived("conversation", True)
        assert destination.list_sessions_rich() == []
        assert destination.set_session_archived("conversation", False)
        assert destination.resolve_resume_session_id("conversation") == "conversation"
        assert _contents(destination, "conversation")[0] == content
        assert attachment.read_bytes() == b"existing local attachment"
        assert local.delete_session("conversation")
        assert local.get_session("conversation") is None
        assert _contents(other, "conversation") == ["Another account's local history"]
        assert _contents(destination, "conversation") == [content, "Saved after reopening"]


def test_local_archive_and_prune_keep_active_pinned_and_recent_history(tmp_path):
    with SessionDB(tmp_path / "state.db") as db:
        old = time.time() - 200 * 86400
        for session_id in ("old", "pinned", "active", "recent"):
            db.create_session(session_id, source="desktop")
            db.append_message(session_id, "user", session_id, timestamp=old if session_id != "recent" else None)
            if session_id != "active":
                db.end_session(session_id, "user_exit")
        db._execute_write(lambda conn: conn.execute(
            "UPDATE sessions SET started_at=?, last_activity_at=NULL, "
            "ended_at=CASE WHEN ended_at IS NULL THEN NULL ELSE ? END WHERE id != 'recent'",
            (old, old),
        ))
        assert db.set_session_pinned("pinned", True)
        assert db.archive_sessions(older_than_days=90) == 1
        assert db.get_session("old")["archived"] == 1
        assert db.set_session_archived("old", False)
        assert {row["id"] for row in db.list_prune_candidates(older_than_days=90)} == {"old"}
        assert db.prune_sessions(older_than_days=90) == 1
        assert db.get_session("old") is None
        for session_id in ("active", "pinned", "recent"):
            assert _contents(db, session_id) == [session_id]
            assert not db.get_session(session_id)["archived"]
