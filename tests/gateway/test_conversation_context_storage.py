"""Durable, generation-scoped public context and traceable summary recovery."""

from dataclasses import replace
from types import SimpleNamespace

import pytest

from gateway import hosted_rooms
from gateway.hosted_room_conversation_context import ContextBudgetError, TurnEnvelope
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, TurnSubmission
from hermes_state import SessionDB


def _conversation(tmp_path, monkeypatch):
    monkeypatch.setattr(hosted_rooms, "local_authority_gateway_id", lambda: "host")
    store = ConversationStore(tmp_path / "shared-state.db")
    general = ParticipantRef("general", "host", "default", "Aino", True)
    store.create("c1", "Shared", general, None)
    return store, store.bind_participant("c1", general)


@pytest.mark.parametrize("finish_reason", ["stop", "STOP", "end"])
def test_summary_reads_all_public_history_and_keeps_proof_after_reopen(tmp_path, monkeypatch, finish_reason):
    from gateway.hosted_room_conversation_summaries import prepare_turn_envelope

    store, binding = _conversation(tmp_path, monkeypatch)
    admissions = [store.append_input("c1", TurnSubmission(
        f"turn-{i}", f"input-{i}", "general", f"Fact {i}: " + "details " * 200,
    )) for i in range(110)]
    cutoff = admissions[-1].seq
    requested = TurnSubmission("new-turn", "new-input", "general", "Recap")
    calls = []

    def summarize(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(
            message=SimpleNamespace(content="Public facts recap."), finish_reason=finish_reason)])

    monkeypatch.setattr("agent.auxiliary_client.call_llm", summarize)
    envelope = prepare_turn_envelope(
        store, binding=binding, request=requested, input_cutoff=cutoff,
        budget_bytes=40000, main_runtime={"provider": "test", "model": "test"},
    )
    assert len(calls) == 1 and calls[0]["task"] == "compression"
    assert "Fact 0:" in calls[0]["messages"][-1]["content"]
    assert "Fact 109:" in calls[0]["messages"][-1]["content"]
    assert set(envelope.source_event_ids) == {item.event_id for item in admissions}
    assert "Public facts recap." in envelope.text and 'author_id="user"' in envelope.text
    reopened = ConversationStore(store.db_path)
    replay = prepare_turn_envelope(
        reopened, binding=binding, request=requested, input_cutoff=cutoff,
        budget_bytes=40000, main_runtime={"provider": "test", "model": "test"},
    )
    assert replay == envelope and len(calls) == 1
    revision = store.get("c1").revision
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.save_summary("c1", revision - 1, "stale", cutoff, envelope.source_event_ids,
                           participant_id="general", session_generation=1)
    with pytest.raises(ContextBudgetError):
        prepare_turn_envelope(store, binding=binding, request=requested,
                              input_cutoff=cutoff, budget_bytes=10, main_runtime={})


@pytest.mark.parametrize("finish_reason", ["length", "MAX_TOKENS", "incomplete", "content_filter", None])
def test_incomplete_summary_cannot_persist_coverage(tmp_path, monkeypatch, finish_reason):
    from gateway.hosted_room_conversation_summaries import prepare_turn_envelope

    store, binding = _conversation(tmp_path, monkeypatch)
    prior = store.append_input("c1", TurnSubmission("t0", "i0", "general", "Public fact. " * 1000))
    before = store.context_snapshot(binding, prior.seq)
    monkeypatch.setattr("agent.auxiliary_client.call_llm", lambda **kwargs: SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="The first fact was"),
                                 finish_reason=finish_reason)]))

    with pytest.raises(ContextBudgetError):
        prepare_turn_envelope(
            store, binding=binding, request=TurnSubmission("t1", "i1", "general", "Recap"),
            input_cutoff=prior.seq, budget_bytes=4000, main_runtime={},
        )

    reopened = ConversationStore(store.db_path)
    assert reopened.context_snapshot(binding, prior.seq) == before
    with hosted_rooms._transaction(store.db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM hosted_conversation_summaries").fetchone()[0] == 0


def test_context_snapshot_keeps_revision_and_coverage_from_one_read(tmp_path, monkeypatch):
    store, binding = _conversation(tmp_path, monkeypatch)
    prior = store.append_input("c1", TurnSubmission("t0", "i0", "general", "Public fact"))
    before = store.context_snapshot(binding, prior.seq)
    writer = ConversationStore(store.db_path)
    get_record = store._get_locked

    def write_after_reading_record(conn, conversation_id):
        record = get_record(conn, conversation_id)
        writer.save_summary(
            "c1", record.revision, "Public recap", prior.seq, (prior.event_id,),
            participant_id="general", session_generation=binding.session_generation,
        )
        return record

    # Commit on another real WAL connection between the record and coverage reads.
    monkeypatch.setattr(store, "_get_locked", write_after_reading_record)
    assert store.context_snapshot(binding, prior.seq) == before
    after = writer.context_snapshot(binding, prior.seq)
    assert after[0].revision > before[0].revision
    assert after[2].summary_source_ids == {prior.event_id}
    assert after[2].summary_text == "Public recap"


def test_coverage_advances_only_with_exact_durable_receipt_and_is_generation_scoped(tmp_path, monkeypatch):
    store, binding = _conversation(tmp_path, monkeypatch)
    prior = store.append_input("c1", TurnSubmission("t0", "i0", "general", "Earlier public fact"))
    current = store.append_input("c1", TurnSubmission("t1", "i1", "general", "New question"))
    envelope = TurnEnvelope("Bridged question", "digest", (prior.event_id,), prior.seq, 0)
    store.prepare_input(binding, "i1", envelope)
    assert store.prepared_input("c1", "i1") == envelope
    assert not store.context_coverage(binding).received_event_ids
    with SessionDB(tmp_path / "state.db") as db:
        db.create_session("profile-session", source="desktop")
        receipt = db.accept_conversation_input(
            "profile-session", input_id="i1", input_digest="digest",
            message={"role": "user", "content": "Bridged question"},
            conversation_id="c1", participant_id="general", session_generation=1,
        )
    # A process stops after Profile commit, before the shared ACK. Recovery reads
    # the receipt, not a newly generated model request or another user insertion.
    store = ConversationStore(store.db_path)
    assert not store.context_coverage(binding).received_event_ids
    with SessionDB(tmp_path / "state.db") as db:
        receipt = db.get_conversation_input_receipt("i1")
        assert receipt is not None
        store.ack_input("c1", "general", 1, receipt, (prior.event_id,), prior.seq)
        store.ack_input("c1", "general", 1, receipt, (prior.event_id,), prior.seq)
        covered = store.context_coverage(binding)
        assert covered.received_event_ids == {prior.event_id, current.event_id}
        assert not store.context_coverage(replace(binding, session_generation=2)).received_event_ids
        with pytest.raises(hosted_rooms.RoomConflictError):
            store.ack_input("c1", "general", 1, replace(receipt, input_digest="changed"),
                            (prior.event_id,), prior.seq)
        with pytest.raises(hosted_rooms.RoomConflictError):
            store.ack_input("c1", "general", 1, receipt, ("missing-event",), prior.seq)
        assert len(db.get_messages("profile-session")) == 1
    assert ConversationStore(store.db_path).context_coverage(binding) == covered
