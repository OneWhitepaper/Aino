"""Local history remains durable, portable and isolated during desktop changes."""

import json
import time

from persistence_assembly import open_persistence, profile_scope
from persistence.conversation.sessions import NewSession, SessionQuery, SessionWindow
from persistence.conversation.messages import NewMessage
from tests.fixtures.storage_holder import raw_holder
from tests.hermes_cli.test_desktop_history_recovery import _export_session


def _contents(db, session_id):
    return [message["content"] for message in [row.as_wire_row() for row in db.messages.read_transcript(session_id)]]


def test_local_history_round_trip_preserves_existing_attachments_and_account_isolation(tmp_path):
    first, second, restored = (tmp_path / name for name in ("first-account", "second-account", "restored"))
    for home in (first, second, restored):
        home.mkdir()
    attachment = first / "cloud-sync" / "media" / "existing.png"
    attachment.parent.mkdir(parents=True)
    attachment.write_bytes(b"existing local attachment")
    content = f"Existing attachment: ![image]({attachment})"
    with open_persistence(profile_scope(home=first)) as db:
        db.sessions.create(NewSession(session_id="conversation", source="desktop"))
        db.messages.append("conversation", NewMessage(role="user", content=content))

    with (open_persistence(profile_scope(home=first)) as local,
          open_persistence(profile_scope(home=second)) as other,
          open_persistence(profile_scope(home=restored)) as destination):
        assert _contents(local, "conversation") == [content]
        local.messages.append("conversation", NewMessage(role="assistant", content="Saved after reopening"))
        other.sessions.create(NewSession(session_id="conversation", source="desktop"))
        other.messages.append("conversation", NewMessage(role="user", content="Another account's local history"))
        payload = json.loads(json.dumps(_export_session(local, "conversation", include_inactive=True)))
        result = destination.maintenance.import_sessions([payload])
        assert result.ok and result.imported == 1, result
        assert _contents(destination, "conversation") == [content, "Saved after reopening"]
        assert destination.sessions.set_archived("conversation", True)
        assert not destination.sessions.list_sessions(SessionQuery(), SessionWindow(limit=20))
        assert destination.sessions.set_archived("conversation", False)
        assert destination.lineage.resolve_resume_target("conversation") == "conversation"
        assert _contents(destination, "conversation")[0] == content
        assert attachment.read_bytes() == b"existing local attachment"
        assert local.sessions.delete("conversation", media_root=str(first))
        assert local.sessions.get("conversation") is None
        assert _contents(other, "conversation") == ["Another account's local history"]
        assert _contents(destination, "conversation") == [content, "Saved after reopening"]


def test_local_archive_and_prune_keep_active_pinned_and_recent_history(tmp_path):
    with open_persistence(profile_scope(home=tmp_path)) as db:
        old = time.time() - 200 * 86400
        for session_id in ("old", "pinned", "active", "recent"):
            db.sessions.create(NewSession(session_id=session_id, source="desktop"))
            db.messages.append(session_id, NewMessage(role="user", content=session_id, timestamp=old if session_id != "recent" else None))
            if session_id != "active":
                db.sessions.end(session_id, "user_exit")
        raw_holder(db)._execute_write(lambda conn: conn.execute(
            "UPDATE sessions SET started_at=?, last_activity_at=NULL, "
            "ended_at=CASE WHEN ended_at IS NULL THEN NULL ELSE ? END WHERE id != 'recent'",
            (old, old),
        ))
        assert db.sessions.set_pinned("pinned", True)
        assert __import__("session_retention").archive_sessions(db, tmp_path, older_than_days=90) == 1
        assert db.sessions.get("old").archived == 1
        assert db.sessions.set_archived("old", False)
        assert {row.session_id for row in db.maintenance.list_prune_candidates(older_than_days=90)} == {"old"}
        assert db.maintenance.prune_sessions(older_than_days=90, media_root=str(tmp_path)).count == 1
        assert db.sessions.get("old") is None
        for session_id in ("active", "pinned", "recent"):
            assert _contents(db, session_id) == [session_id]
            assert not db.sessions.get(session_id).archived
