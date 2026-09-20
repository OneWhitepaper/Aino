"""Durable user-input receipts bind one shared input to one Profile transcript row."""

from __future__ import annotations

import hashlib
import os

import pytest

from hermes_state import SessionDB
from hermes_state_errors import SessionCompressionInProgressError, SessionTurnLeaseLostError


def _digest(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _accept(db: SessionDB, session_id: str, **overrides):
    content = overrides.pop("content", "shared input")
    values = {
        "input_id": "input-1",
        "input_digest": _digest(content),
        "message": {"role": "user", "content": content},
        "conversation_id": "conversation-1",
        "participant_id": "participant-a",
        "session_generation": 4,
    }
    values.update(overrides)
    return db.accept_conversation_input(session_id, **values)


def test_receipt_replay_survives_reopen_and_compression_rotation(tmp_path):
    path = tmp_path / "state.db"
    db = SessionDB(path)
    db.create_session("profile-session", source="test")

    first = _accept(db, "profile-session")
    assert first.input_id == "input-1"
    assert first.input_digest == _digest("shared input")
    assert first.session_id == "profile-session"
    assert first.idempotent is False

    replayed = _accept(db, "profile-session")
    assert replayed.message_row_id == first.message_row_id
    assert replayed.idempotent is True
    marked_replay = _accept(
        db,
        "profile-session",
        message={"role": "user", "content": "shared input", "_db_persisted": True},
    )
    assert marked_replay.message_row_id == first.message_row_id
    assert [m["content"] for m in db.get_messages("profile-session") if m["role"] == "user"] == [
        "shared input"
    ]

    db.end_session("profile-session", "compression")
    db.create_session(
        "profile-session-next",
        source="test",
        parent_session_id="profile-session",
    )
    rotated_replay = _accept(db, "profile-session-next")
    assert rotated_replay.message_row_id == first.message_row_id
    assert rotated_replay.session_id == "profile-session"
    db.close()

    reopened = SessionDB(path)
    try:
        recovered = reopened.get_conversation_input_receipt("input-1")
        assert recovered is not None
        assert recovered.message_row_id == first.message_row_id
        assert recovered.idempotent is True
    finally:
        reopened.close()


@pytest.mark.parametrize(
    "changes",
    [
        {"input_digest": _digest("different")},
        {"message": {"role": "user", "content": "different"}},
        {"conversation_id": "conversation-2"},
        {"participant_id": "participant-b"},
        {"session_generation": 5},
    ],
)
def test_receipt_identity_conflicts_do_not_append(changes, tmp_path):
    db = SessionDB(tmp_path / "state.db")
    db.create_session("profile-session", source="test")
    db.create_session("unrelated-session", source="test")
    first = _accept(db, "profile-session")

    with pytest.raises(ValueError, match="input-1"):
        _accept(db, "profile-session", **changes)
    with pytest.raises(ValueError, match="input-1"):
        _accept(db, "unrelated-session")

    assert db.get_session("profile-session")["message_count"] == 1
    assert db.get_session("unrelated-session")["message_count"] == 0
    assert db.get_conversation_input_receipt("input-1").message_row_id == first.message_row_id
    db.close()


def test_receipt_and_message_roll_back_together_before_commit(tmp_path, monkeypatch):
    db = SessionDB(tmp_path / "state.db")
    db.create_session("profile-session", source="test")
    execute_write = db._execute_write

    def fail_at_commit_boundary(fn, patience_s=None):
        def run_then_fail(conn):
            fn(conn)
            raise RuntimeError("injected before commit")

        return execute_write(run_then_fail, patience_s=patience_s)

    monkeypatch.setattr(db, "_execute_write", fail_at_commit_boundary)
    with pytest.raises(RuntimeError, match="before commit"):
        _accept(db, "profile-session")
    monkeypatch.setattr(db, "_execute_write", execute_write)

    assert db.get_conversation_input_receipt("input-1") is None
    assert db.get_messages("profile-session") == []
    assert db.get_session("profile-session")["message_count"] == 0
    db.close()


def test_conversation_input_rejects_non_user_rows(tmp_path):
    db = SessionDB(tmp_path / "state.db")
    db.create_session("profile-session", source="test")

    with pytest.raises(ValueError, match="role='user'"):
        _accept(
            db,
            "profile-session",
            message={"role": "assistant", "content": "not a user input"},
        )

    assert db.get_messages("profile-session") == []
    assert db.get_conversation_input_receipt("input-1") is None
    db.close()


@pytest.mark.parametrize("guard", ["turn", "compression"])
def test_new_input_honors_active_transcript_guards(guard, tmp_path, monkeypatch):
    db = SessionDB(tmp_path / "state.db")
    db.create_session("profile-session", source="test")
    holder = f"pid={os.getpid()}:receipt-test"
    if guard == "turn":
        assert db.try_acquire_session_turn_lease("profile-session", holder, ttl_seconds=60)
        expected = SessionTurnLeaseLostError
    else:
        assert db.try_acquire_compression_lock("profile-session", holder, ttl_seconds=60)
        monkeypatch.setattr(db, "_COMPRESSION_BUSY_WAIT_S", 0.0)
        expected = SessionCompressionInProgressError

    with pytest.raises(expected):
        _accept(db, "profile-session")

    assert db.get_conversation_input_receipt("input-1") is None
    assert db.get_messages("profile-session") == []
    db.close()
