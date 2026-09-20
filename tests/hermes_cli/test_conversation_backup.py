"""Recovery verifies real Profile receipts, public coverage and durable content."""
from dataclasses import asdict
from pathlib import Path
import json

import pytest

from gateway import hosted_rooms
from gateway.hosted_room_conversation_bindings import ConversationBindings
from gateway.hosted_room_conversation_content import ConversationContentStore
from gateway.hosted_room_conversation_context import TurnEnvelope
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission
from hermes_cli.conversation_backup import (
    ConversationBackupError, create_conversation_snapshot, verify_conversation_snapshot,
)
from hermes_state import SessionDB


def _history(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    authority = hosted_rooms.local_authority_gateway_id()
    store = ConversationStore(root / "shared-state.db")
    general = ParticipantRef("general", authority, "default", "General", True)
    store.create("chat", "Three authors", general, None)
    bindings = ConversationBindings(store.db_path)
    for index, profile in enumerate(("default", "writer", "reviewer")):
        home = root if profile == "default" else root / "profiles" / profile
        home.mkdir(parents=True, exist_ok=True)
        participant = general if index == 0 else ParticipantRef(profile, authority, profile, profile)
        binding = store.bind_participant("chat", participant)
        sid = "session-" + profile
        with SessionDB(home / "state.db") as db:
            db.create_session(sid, source="desktop")
            bindings.publish(binding, None, {
                "conversation_id": "chat", "participant_id": participant.participant_id,
                "session_generation": 1, "lineage_id": sid, "profile": profile,
                "profile_home": str(home), "cwd": str(tmp_path), "source": "desktop",
                "auth_user_id": None, "model_snapshot": "{}", "capability_digest": "",
                "system_prompt_digest": None, "selection_json": "{}",
            })
            binding = next(b for b in store.participants("chat") if b.participant == participant)
            prior = tuple(item.event_id for item in store.public_history("chat", index))
            input_id = "input-" + profile
            store.append_input("chat", TurnSubmission("turn-" + profile, input_id, participant.participant_id, profile))
            envelope = TurnEnvelope(profile, "digest-" + profile, prior, index, 0)
            store.prepare_input(binding, input_id, envelope)
            receipt = db.accept_conversation_input(sid, input_id=input_id, input_digest=envelope.input_digest,
                message={"role": "user", "content": profile}, conversation_id="chat",
                participant_id=participant.participant_id, session_generation=1)
            store.ack_input("chat", participant.participant_id, 1, receipt, prior, index)
    text = "完整长答案" * 20000
    ref = ConversationContentStore(store.db_path).put_for_conversation("chat", text.encode(), "text/plain; charset=utf-8")
    return root, store, ref, text


def test_snapshot_preserves_all_profile_receipts_and_detects_inconsistent_ack(tmp_path, monkeypatch):
    root, store, ref, text = _history(tmp_path, monkeypatch)
    snapshot = tmp_path / "snapshot"
    manifest = create_conversation_snapshot(root / "profiles" / "writer", snapshot)
    assert verify_conversation_snapshot(snapshot) == manifest
    assert {row["profile"] for row in manifest["projection"]["receipts"]} == {"default", "writer", "reviewer"}
    assert manifest["projection"]["event_cutoffs"]["chat"] == len(store.events("chat").events)
    assert ConversationContentStore(snapshot / "shared-state.db").read_for_conversation("chat", ref.id).decode() == text
    # Corrupt the live relationship before making the next otherwise-valid SQLite copies.
    with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
        row = conn.execute("SELECT receipt_json FROM hosted_conversation_input_acks WHERE input_id='input-writer'").fetchone()
        receipt = json.loads(row[0])
        receipt["message_row_id"] += 100
        conn.execute("UPDATE hosted_conversation_input_acks SET receipt_json=? WHERE input_id='input-writer'",
                     (json.dumps(receipt),))
    with pytest.raises(ConversationBackupError, match="ACK differs"):
        create_conversation_snapshot(root, tmp_path / "bad")
    assert not (tmp_path / "bad").exists()
    assert verify_conversation_snapshot(snapshot) == manifest


def test_snapshot_timeout_publishes_nothing_and_missing_profile_is_not_silent(tmp_path, monkeypatch):
    from gateway.hosted_room_conversation_maintenance import managed_operation, MaintenanceTimeout
    import threading
    root, _, _, _ = _history(tmp_path, monkeypatch)
    entered, release = threading.Event(), threading.Event()
    def writing():
        with managed_operation(root):
            entered.set()
            assert release.wait(10)
    thread = threading.Thread(target=writing)
    thread.start()
    try:
        assert entered.wait(5)
        with pytest.raises(MaintenanceTimeout):
            create_conversation_snapshot(root, tmp_path / "blocked", timeout=0.05)
        assert not (tmp_path / "blocked").exists()
    finally:
        release.set()
        thread.join(5)
    (root / "profiles" / "reviewer" / "state.db").unlink()
    with pytest.raises(ConversationBackupError, match="Missing required database"):
        create_conversation_snapshot(root, tmp_path / "missing")
    assert not (tmp_path / "missing").exists()
