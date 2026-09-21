"""Rewinds address stored user turns even when provider replay merged their rows."""

from copy import deepcopy
import threading

import pytest

from agent.agent_runtime_helpers import repair_message_sequence
from hermes_state import SessionDB
from tui_gateway import server


@pytest.fixture
def rewind_session(tmp_path, monkeypatch):
    db = SessionDB(db_path=tmp_path / "state.db")
    key = "repaired-rewind"
    db.create_session(key, source="desktop")
    session = {
        "session_key": key,
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
    }
    monkeypatch.setattr(server, "_get_db", lambda: db)
    yield db, key, session
    db.close()


@pytest.mark.parametrize("marker", [False, True])
@pytest.mark.parametrize("target_ordinal", [1, 2])
def test_rewind_restores_durable_boundaries_of_merged_user_turns(
    rewind_session, marker, target_ordinal
):
    db, key, session = rewind_session
    db.append_message(key, "user", "hello")
    db.append_message(key, "assistant", "hello back")
    session["history"] = db.get_messages_as_conversation(key, include_row_ids=True)
    if marker:
        server._append_model_switch_marker(session, model="selected-model", provider="aino")
    user_ids = [
        db.append_message(key, "user", "who are you?"),
        db.append_message(key, "user", "hello"),
    ]
    db.append_message(key, "assistant", "selected-model reply")
    physical = db.get_messages_as_conversation(key, include_row_ids=True)
    session["history"] = deepcopy(physical)
    if marker:
        # Gateway-created pivot and the current prompt are warm-only rows until
        # the next durable read; row-id healing must map them positionally.
        for message in session["history"]:
            if message.get("display_kind") == "model_switch" or message.get("content") == "who are you?":
                message.pop("_row_id", None)
    # The real provider preparation collapses the marker and the interrupted
    # prompt into one row in the old implementation. Pivot rows now retain their
    # boundaries in live history; only the request-local wire copy may merge them.
    assert repair_message_sequence(None, session["history"]) > 0
    target_id = user_ids[target_ordinal - 1]
    target_index = next(i for i, message in enumerate(physical) if message["_row_id"] == target_id)
    original_ids = [message["_row_id"] for message in physical]

    with session["history_lock"]:
        error, fields = server._truncate_history_for_submit(
            "request", key, session,
            {"truncate_before_row_id": target_id, "confirm_truncate": True},
            set(original_ids),
        )

    assert error is None, error
    expected = [(message["role"], message["content"]) for message in physical[:target_index]]
    assert [(message["role"], message["content"]) for message in session["history"]] == expected
    assert [(message["role"], message["content"]) for message in db.get_messages_as_conversation(key)] == expected
    active = db.get_messages_as_conversation(key, include_row_ids=True)
    assert fields["survivor_row_id_map"] == {
        str(old_id): active[i]["_row_id"] if i < len(active) else None
        for i, old_id in enumerate(original_ids)
    }
    archived = db.get_messages_as_conversation(key, include_inactive=True, include_row_ids=True)
    assert any(message["_row_id"] == target_id for message in archived)


def test_rewind_refuses_repaired_history_when_live_content_diverged(rewind_session):
    db, key, session = rewind_session
    db.append_message(key, "user", "hello")
    db.append_message(key, "assistant", "hello back")
    db.append_message(key, "user", "interrupted prompt")
    target_id = db.append_message(key, "user", "follow-up")
    db.append_message(key, "assistant", "reply")
    physical = db.get_messages_as_conversation(key, include_row_ids=True)
    session["history"] = deepcopy(physical)
    repair_message_sequence(None, session["history"])
    session["history"][-1]["content"] = "a different live answer"
    before = deepcopy(session["history"])

    with session["history_lock"]:
        error, _ = server._truncate_history_for_submit(
            "request", key, session,
            {"truncate_before_row_id": target_id, "confirm_truncate": True}, None,
        )

    assert error["error"]["code"] == 4018
    assert session["history"] == before
    assert db.get_messages_as_conversation(key, include_row_ids=True) == physical
