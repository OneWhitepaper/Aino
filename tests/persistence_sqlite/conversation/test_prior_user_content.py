"""Bounded replay corroboration is profile/session/row scoped, not a transcript hydration."""
import pytest

from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import NewSession
from persistence_assembly import open_persistence, profile_scope


@pytest.mark.parametrize("parts", [False, True])
def test_prior_user_content_probe_keeps_exact_and_merged_replay_rules(tmp_path, parts):
    with open_persistence(profile_scope(home=tmp_path)) as store:
        for sid in ("owned", "foreign"):
            store.sessions.create(NewSession(session_id=sid, source="cli"))
        content = [{"type": "text", "text": "original task"}] if parts else "original task"
        row = store.messages.append("owned", NewMessage("user", content, timestamp=123))
        store.messages.append("foreign", NewMessage("user", "foreign task", timestamp=123))
        hidden = store.messages.append("owned", NewMessage("user", "hidden task", display_kind="hidden", timestamp=123))
        probe = store.messages.has_prior_user_content
        assert not probe("owned", row, content, timestamp=123)
        assert probe("owned", hidden + 1, content, timestamp=123)
        assert not probe("owned", hidden + 1, content, timestamp=124)
        assert not probe("owned", hidden + 1, "foreign task", timestamp=123)
        assert not probe("owned", hidden + 1, "hidden task", timestamp=123)
        assert probe("owned", hidden + 1, "original task", flatten_multimodal=True)
        assert probe("owned", hidden + 1, "original task") is (not parts)
