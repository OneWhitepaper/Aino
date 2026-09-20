"""Behavior contracts for ordinary conversations stored on the Hosted room log."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest

from gateway import hosted_room_replicas, hosted_rooms
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, ProjectRef, TurnSubmission


@pytest.fixture
def identities(monkeypatch):
    monkeypatch.setattr(hosted_rooms, "local_authority_gateway_id", lambda: "gateway-test")
    monkeypatch.setattr(hosted_room_replicas, "local_authority_gateway_id", lambda: "gateway-test")
    return (
        ParticipantRef("general", "install-test", "default", "Aino", True),
        ParticipantRef("writer", "install-test", "writer", "Novel writer"),
    )


def test_preparing_participant_does_not_overwrite_a_concurrent_conversation_revision(tmp_path, identities):
    general, writer = identities
    store = ConversationStore(tmp_path / 'shared-state.db')
    created = store.create('c1', 'Novel', general, None)
    other_window = ConversationStore(store.db_path)
    other_window.append_input('c1', TurnSubmission('another-turn', 'another-input', general.participant_id, 'New request'))
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.bind_participant('c1', writer, expected_revision=created.revision)
    assert [row.participant for row in store.participants('c1')] == [general]
    revision = store.get('c1').revision
    store.bind_participant('c1', writer, expected_revision=revision)
    assert store.get('c1').revision == revision + 1
    # Even an idempotent bind cannot disguise the caller's stale public view.
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.bind_participant('c1', writer, expected_revision=revision)


def test_input_retry_is_immutable_and_preserves_public_authorship(tmp_path, identities):
    db = tmp_path / "shared-state.db"
    general, writer = identities
    store = ConversationStore(db)
    project = ProjectRef("install-test", "default", "novel", "/work/novel", "local")

    created = store.create("c1", "Novel", general, project)
    binding = store.bind_participant("c1", writer)
    first = store.append_input(
        "c1", TurnSubmission("turn-1", "input-1", "writer", "Design the protagonist", ("asset-1",))
    )
    replay = store.append_input(
        "c1", TurnSubmission("turn-1", "input-1", "writer", "Design the protagonist", ("asset-1",))
    )

    assert created.general == general
    assert created.project == project
    assert binding.participant == writer
    assert binding.session_generation == 1
    assert binding.lineage_id is None
    assert first.event_id == replay.event_id
    assert first.seq == replay.seq == 1
    assert replay.idempotent is True
    page = store.events("c1")
    assert page.cursor == 1 and page.has_more is False
    assert page.events == (
        {
            "room_id": "c1",
            "seq": 1,
            "event_id": first.event_id,
            "kind": "conversation.input",
            "actor": {"kind": "user", "id": "user", "display_name": "User"},
            "authority_epoch": 1,
            "payload": {
                "turn_id": "turn-1",
                "input_id": "input-1",
                "text": "Design the protagonist",
                "attachment_ids": ["asset-1"],
                "target_participant_id": "writer",
                "target_display_name_at_time": "Novel writer",
                "author_display_name_at_time": "User",
            },
            "created_at": page.events[0]["created_at"],
            "idempotent": False,
        },
    )

    for changed in (
        TurnSubmission("turn-1", "input-1", "general", "Design the protagonist", ("asset-1",)),
        TurnSubmission("turn-1", "input-1", "writer", "Change the protagonist", ("asset-1",)),
        TurnSubmission("turn-1", "input-1", "writer", "Design the protagonist", ("asset-2",)),
    ):
        with pytest.raises(hosted_rooms.RoomConflictError):
            store.append_input("c1", changed)


def test_conversation_creation_rolls_back_room_when_metadata_insert_fails(tmp_path, identities):
    db = tmp_path / "shared-state.db"
    general, _writer = identities
    store = ConversationStore(db)
    with sqlite3.connect(db) as conn:
        conn.execute(
            """CREATE TRIGGER reject_c1_conversation
               BEFORE INSERT ON hosted_room_conversations
               WHEN NEW.conversation_id = 'c1'
               BEGIN SELECT RAISE(ABORT, 'metadata rejected'); END"""
        )

    with pytest.raises(sqlite3.IntegrityError, match="metadata rejected"):
        store.create("c1", "Novel", general, None)

    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT 1 FROM hosted_rooms WHERE room_id='c1'").fetchone() is None


def test_discussion_apis_and_runtime_never_adopt_conversation_rooms(tmp_path, identities):
    from tui_gateway.hosted_room_service import HostedRoomService

    db = tmp_path / "shared-state.db"
    general, _writer = identities
    hosted_rooms.create_room(
        db,
        room_id="discussion-1",
        name="Review group",
        members=[{"member_id": "general", "profile": "default", "handle": "aino"}],
        authority_gateway_id="gateway-test",
    )
    store = ConversationStore(db)
    store.create("conversation-1", "Novel", general, None)
    store.append_input(
        "conversation-1", TurnSubmission("turn-1", "input-1", "general", "Start the novel")
    )

    assert [room["room_id"] for room in hosted_rooms.list_rooms(db)] == ["discussion-1"]
    assert hosted_rooms.probe_hosted_room(db, room_id="discussion-1") is True
    assert hosted_rooms.probe_hosted_room(db, room_id="conversation-1") is False
    service = HostedRoomService(SimpleNamespace(_methods={}), db_path=db)
    assert [binding.room_id for binding in service.bindings()] == ["discussion-1"]

    with pytest.raises(hosted_rooms.RoomNotFoundError):
        hosted_rooms.room_state(db, room_id="conversation-1")
    with pytest.raises(hosted_rooms.RoomNotFoundError):
        hosted_rooms.append_event(
            db,
            room_id="conversation-1",
            event_id="group-input",
            kind="message.user",
            actor={"kind": "user", "id": "desktop"},
            payload={"text": "wrong path", "thread_id": "thread-1"},
            authority_gateway_id="gateway-test",
            authority_epoch=1,
        )
    with pytest.raises(hosted_rooms.HostedRoomError, match="conversation events"):
        hosted_rooms.append_event(
            db,
            room_id="discussion-1",
            event_id="wrong-conversation-event",
            kind="conversation.input",
            actor={"kind": "user", "id": "user"},
            payload={"text": "wrong purpose"},
            authority_gateway_id="gateway-test",
            authority_epoch=1,
        )

    conversation_page = hosted_rooms.read_events(
        db, room_id="conversation-1", purpose="conversation"
    )
    with pytest.raises(hosted_room_replicas.ReplicaError, match="discussion"):
        hosted_room_replicas.ingest_page(
            db,
            room_id="replica-1",
            room_name="Wrong replica",
            members=[],
            page=conversation_page,
        )


def test_rooms_without_a_purpose_migrate_as_discussions(tmp_path):
    db = tmp_path / "legacy.db"
    with sqlite3.connect(db) as conn:
        conn.execute(
            """CREATE TABLE hosted_rooms (
                room_id TEXT PRIMARY KEY, name TEXT NOT NULL, members_json TEXT NOT NULL,
                authority_gateway_id TEXT NOT NULL, authority_epoch INTEGER NOT NULL DEFAULT 1,
                next_seq INTEGER NOT NULL DEFAULT 1, event_bytes INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL,
                updated_at REAL NOT NULL, disbanded_at REAL)"""
        )
        conn.execute(
            "INSERT INTO hosted_rooms VALUES (?, ?, ?, ?, 1, 1, 0, 1, 1, 1, NULL)",
            ("legacy-room", "Legacy group", "[]", "gateway-old"),
        )

    assert hosted_rooms.probe_hosted_room(db, room_id="legacy-room") is True
    assert hosted_rooms.probe_hosted_room(db, room_id="missing-room") is False
    with sqlite3.connect(db) as conn:
        assert "purpose" not in {row[1] for row in conn.execute("PRAGMA table_info(hosted_rooms)")}
    assert hosted_rooms.list_rooms(db)[0]["purpose"] == "discussion"
    assert hosted_rooms.probe_hosted_room(db, room_id="legacy-room") is True


def test_peer_reservations_reject_known_conversations(tmp_path, identities):
    db = tmp_path / "shared-state.db"
    general, _writer = identities
    store = ConversationStore(db)
    store.create("conversation-1", "Novel", general, None)
    claims = {
        "room_id": "conversation-1", "member_id": "writer", "target_profile": "writer",
        "authority_gateway_id": "remote-host", "authority_epoch": 1,
    }
    with pytest.raises(hosted_rooms.HostedRoomError):
        hosted_rooms.reserve_peer_room(db, claims=claims, expires_at=300, now=100)
    assert not hosted_rooms.peer_room_is_reserved(
        db, room_id="conversation-1", target_profile="writer", now=100,
    )
    hosted_rooms.reserve_peer_room(
        db, claims={**claims, "room_id": "prospective-discussion"}, expires_at=300, now=100,
    )
    assert hosted_rooms.peer_room_is_reserved(
        db, room_id="prospective-discussion", target_profile="writer", now=100,
    )
