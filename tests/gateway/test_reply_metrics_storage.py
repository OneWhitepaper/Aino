"""Canonical viewer reply metrics use the owning persistence handle, never a legacy store."""

from types import SimpleNamespace

from gateway.config import Platform
from gateway.session_usage import begin_reply_metrics
from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import NewSession
from persistence_assembly import open_persistence, profile_scope
from tui_gateway.turn_metrics import finish_turn_metrics


def test_reply_metrics_preserve_the_bounded_storage_row_and_provider_history(tmp_path):
    with open_persistence(profile_scope(home=tmp_path)) as store:
        store.sessions.create(NewSession("reply", "desktop"))
        store.messages.append("reply", NewMessage("user", "old question"))
        previous = store.messages.append("reply", NewMessage("assistant", "old answer"))
        agent = SimpleNamespace(session_id="reply", _session_db=store, persistence=store)
        turn = SimpleNamespace(_approval_owner=(None, "reply", 1), _ctx=SimpleNamespace(
            source=SimpleNamespace(platform=Platform.LOCAL), mute_notification_reply=False))
        session, start = begin_reply_metrics(turn, agent, [])
        assert session["created_at"] == store.sessions.get("reply").started_at
        assert start.after_row_id == previous
        store.messages.append("reply", NewMessage("user", "next question"))
        store.messages.append("reply", NewMessage("assistant", "next answer"))
        session["history"] = [{"role": "user", "content": "next question"},
                              {"role": "assistant", "content": "next answer"}]
        metrics = finish_turn_metrics(agent, session, start, {}, "next answer", persist=True)
        rows = store.messages.read_transcript("reply")
        assert not (rows[1].display_metadata or {}).get("turn_metrics")
        assert rows[-1].display_metadata["turn_metrics"] == metrics
        assert [row.content for row in store.messages.read_conversation("reply")] == [
            "old question", "old answer", "next question", "next answer"]
