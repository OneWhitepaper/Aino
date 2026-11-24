"""Contract cases for the backend door the interface declares: every registered backend is a ``PersistenceBackend`` whose ``open(scope)`` returns a ``PersistenceStore`` bound to that one profile."""

from __future__ import annotations

import typing
import json
import os
import subprocess
import sys
import time

import psutil
import pytest

from persistence import AuthorityRefusal, FenceStale
from persistence.authority.bindings import local_session_id
from persistence.authority.runtime import DeferredPick, mutation_receipt_key
from persistence.authority.vocabulary import CONVERSATION_MODEL_SELECTION_KEY, UNSTARTED_INTERRUPT_EXIT_REASON
from persistence.conversation.messages import MessageRepository
from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import NewSession
from persistence.core.backend import PersistenceBackend, PersistenceStore
from persistence.core.health import StorageHealth
from process_identity import holder_namespace_token
from tests.contracts.authority.test_bindings_contract import make_binding


def test_a_registered_backend_presents_the_declared_door(backend):
    # CONTRACT: the assembly reaches every backend through the declared protocol, not a test-only shape.
    assert isinstance(backend, PersistenceBackend)


def test_a_store_handle_carries_every_declared_repository(backend, scope_a):
    store = backend.open(scope_a)
    repositories = {name: hint for name, hint in typing.get_type_hints(PersistenceStore).items() if getattr(hint, "_is_protocol", False)}
    assert repositories["messages"] is MessageRepository and repositories["health"] is StorageHealth
    # CONTRACT: each repository attribute the store handle declares is present and satisfies its protocol.
    assert [name for name, protocol in repositories.items() if not isinstance(getattr(store, name, None), protocol)] == []


def test_open_binds_a_store_handle_to_one_profile(backend, scope_a, scope_b):
    store_a = backend.open(scope_a)
    store_b = backend.open(scope_b)
    # CONTRACT: the handle is a declared store handle carrying its scope and the backend's declared capabilities.
    assert isinstance(store_a, PersistenceStore)
    assert store_a.scope == scope_a
    assert store_b.scope == scope_b
    assert store_a.capabilities == backend.capabilities
    # CONTRACT: every repository of a handle acts on its own profile only.
    store_a.state_meta.set("door-key", "a")
    assert store_a.state_meta.get("door-key") == "a"
    assert store_b.state_meta.get("door-key") is None
    # CONTRACT: a second open of one profile reaches the same store.
    assert backend.open(scope_a).state_meta.get("door-key") == "a"


def test_message_repository_matches_prior_input_and_merges_only_the_bounded_reply(backend, scope_a):
    store = backend.open(scope_a)
    store.sessions.create(NewSession("messages", "cli"))
    first = store.messages.append("messages", NewMessage("user", [{"type": "text", "text": "hello"}], 10.0))
    reply = store.messages.append("messages", NewMessage("assistant", "reply", display_metadata={"kept": True}))
    later = store.messages.append("messages", NewMessage("assistant", "reply"))
    assert not store.messages.has_prior_user_content("messages", first, "hello", flatten_multimodal=True)
    assert store.messages.has_prior_user_content("messages", reply, "hello", timestamp=10.0, flatten_multimodal=True)
    assert not store.messages.has_prior_user_content("messages", reply, "hello", flatten_multimodal=False)
    assert not store.messages.has_prior_user_content("messages", reply, "hello", timestamp=11.0, flatten_multimodal=True)
    assert store.messages.merge_reply_display_metadata(
        "messages", "reply", after_row_id=first, through_row_id=reply, metadata={"added": "yes"})
    rows = store.messages.read_transcript("messages")
    assert rows[1].display_metadata == {"kept": True, "added": "yes"}
    assert rows[2].id == later and rows[2].display_metadata is None
    assert not store.messages.merge_reply_display_metadata(
        "messages", "reply", after_row_id=later, metadata={"outside": True})


@pytest.mark.parametrize("kind", ["turn", "compression"])
def test_coordination_repository_reports_only_unexpired_leases(backend, scope_a, kind, monkeypatch):
    now = [time.time()]
    monkeypatch.setattr(time, "time", lambda: now[0])
    store = backend.open(scope_a)
    store.sessions.create(NewSession("lease", "cli"))
    acquire = getattr(store.coordination, f"try_acquire_{kind}_lease" if kind == "turn" else "try_acquire_compression_lock")
    release = getattr(store.coordination, f"release_{kind}_lease" if kind == "turn" else "release_compression_lock")
    assert not store.coordination.has_active_leases(session_id="lease")
    assert acquire(session_id="lease", holder="owner", ttl_seconds=300)
    assert store.coordination.has_active_leases(session_id="lease")
    assert not store.coordination.has_active_leases(session_id="unrelated")
    release(session_id="lease", holder="owner")
    assert not store.coordination.has_active_leases(session_id="lease")
    assert acquire(session_id="lease", holder="expired", ttl_seconds=300)
    now[0] += 301
    assert not store.coordination.has_active_leases(session_id="lease")


def test_runtime_selection_fences_epoch_and_pending_pick_before_saving(backend, scope_a):
    store = backend.open(scope_a)
    store.sessions.create(NewSession("selection", "cli"))
    epoch = store.runtime.begin_epoch(instance_id="selection")
    fence = store.runtime.selection_fence("selection")
    assert fence == (0, 0, None)
    selection = {"model": "wanted", "provider": "provider"}
    store.runtime.save_conversation_selection(epoch, "selection", selection, fence)
    assert store.sessions.get("selection").model_config[CONVERSATION_MODEL_SELECTION_KEY] == selection
    with pytest.raises(FenceStale):
        store.runtime.save_conversation_selection(epoch + 1, "selection", {"model": "wrong"}, fence)
    key, digest = mutation_receipt_key(
        "p", "selection", "pick", operation="model", payload={"model": "pending"}, expected_revision=0)
    store.runtime.defer_model_pick(epoch, key=key, digest=digest, session_id="selection",
                                  pick=DeferredPick("model", "p", "pick", {"model": "pending"}))
    assert store.runtime.selection_fence("selection")[2] == store.runtime.deferred_pick("selection").stored
    with pytest.raises(AuthorityRefusal, match="model_request_expired"):
        store.runtime.save_conversation_selection(epoch, "selection", {"model": "stale"}, fence)
    assert store.sessions.get("selection").model_config[CONVERSATION_MODEL_SELECTION_KEY] == selection


def test_binding_reads_check_work_code_ownership_and_project_reviewed_links(backend, scope_a):
    store = backend.open(scope_a)
    epoch = store.runtime.begin_epoch(instance_id="bindings")
    parent = make_binding("parent", route="parent", policy={"execution_mode": "code"})
    store.bindings.reserve(epoch=epoch, binding=parent, owner=None)
    handoff = {"source_session_id": "parent", "summary": "Reviewed"}
    child = make_binding("child", route="child", policy={"request_json": json.dumps({"handoff": handoff})})
    store.sessions.create(NewSession("child", "cli", parent_session_id="parent", model_config={"_branched_from": "parent"}))
    store.runtime.seed_local_receipt("child", {
        "profile_id": child.profile_id, "principal_id": child.principal_id, "request_id": child.request_id,
        "session_id": child.session_id, "route": child.route, "entry": dict(child.entry), "policy": dict(child.policy),
    })
    assert store.bindings.execution_modes(["parent", "child", "missing"]) == {
        "parent": "code", "child": "work", "missing": "work"}
    store.bindings.check_work_code_source("parent", "user-1", "work", None)
    with pytest.raises(AuthorityRefusal, match="permission_denied"):
        store.bindings.check_work_code_source("parent", "other", "work", None)
    with pytest.raises(AuthorityRefusal, match="invalid_params"):
        store.bindings.check_work_code_source("parent", "user-1", "code", None)
    assert store.bindings.work_code_links("child", None) == {
        "handoff": handoff, "linked_sessions": [
            {"session_id": "parent", "title": "", "execution_mode": "code", "relation": "source"}]}
    assert store.bindings.work_code_links("parent", None) == {
        "linked_sessions": [{"session_id": "child", "title": "", "execution_mode": "work", "relation": "child"}]}


def test_binding_empty_hosted_policy_repair_compares_the_original_receipt(backend, scope_a):
    store = backend.open(scope_a)
    epoch = store.runtime.begin_epoch(instance_id="hosted-repair")
    binding = make_binding("hosted", route="hosted", policy={"source": "bot_room", "model": ""})
    store.bindings.reserve(epoch=epoch, binding=binding, owner=None)
    expected = {
        "profile_id": binding.profile_id, "principal_id": binding.principal_id, "request_id": binding.request_id,
        "session_id": binding.session_id, "route": binding.route, "entry": dict(binding.entry), "policy": dict(binding.policy)}
    repaired = {**binding.policy, "model": None}
    assert store.bindings.repair_hosted_empty_policy(
        epoch=epoch, session_id="hosted", expected=expected, repaired=repaired, principal_id="user-1")
    assert store.bindings.receipt("hosted").policy == repaired
    assert store.sessions.get("hosted").model is None
    with pytest.raises(AuthorityRefusal, match="storage_unavailable"):
        store.bindings.repair_hosted_empty_policy(
            epoch=epoch, session_id="hosted", expected=expected, repaired=repaired, principal_id="user-1")


def test_continuation_descriptor_without_a_receipted_continuation_is_empty(backend, scope_a):
    store = backend.open(scope_a)
    store.sessions.create(NewSession("continuation", "cli"))
    epoch = store.runtime.begin_epoch(instance_id="continuation")
    record, _ = store.admissions.admit(epoch=epoch, principal_id="p", session_id="continuation",
                                     request_id="initial", payload={"text": "original"})
    assert store.admissions.continuation_descriptor(record.admission_id) is None
    assert store.admissions.continuation_descriptor("missing") is None


def test_continuation_descriptor_recovers_only_an_exact_unstarted_interruption(backend, scope_a):
    store = backend.open(scope_a)
    store.sessions.create(NewSession("continuation", "cli"))
    epoch = store.runtime.begin_epoch(instance_id="continuation")
    original = {"text": "original", "display_v1": {"text": "shown"},
                "attachments_v1": {"media": [{"path": "retained.png", "kind": "image"}]}}
    record, _ = store.admissions.admit(epoch=epoch, principal_id="p", session_id="continuation",
                                     request_id="original", payload=original)
    claimed = store.admissions.claim(epoch=epoch, session_id="continuation")
    store.admissions.settle(
        epoch=epoch, admission_id=record.admission_id, generation=claimed.generation, outcome="interrupted",
        result={"result": {"interrupted": True, "turn_exit_reason": UNSTARTED_INTERRUPT_EXIT_REASON}})
    continued, _ = store.admissions.admit(
        epoch=epoch, principal_id="p", session_id="continuation", request_id="continued",
        payload={"continuation_v1": {"admission_id": record.admission_id, "execution_generation": claimed.generation,
                                     "revision": store.runtime.selection_fence("continuation")[0]}})
    descriptor = store.admissions.continuation_descriptor(continued.admission_id)
    expected = {
        "admission_id": record.admission_id, "submission_id": "original", "payload": original}
    assert descriptor == expected
    descriptor["payload"]["display_v1"]["text"] = "changed"
    descriptor["payload"]["attachments_v1"]["media"][0]["path"] = "changed.png"
    descriptor["payload"]["attachments_v1"]["media"].append({"path": "extra.png", "kind": "image"})
    assert store.admissions.get(admission_id=record.admission_id).payload == original
    assert store.admissions.continuation_descriptor(continued.admission_id) == expected


def test_room_model_policy_uses_the_frozen_receipt_and_rejects_a_raced_policy(backend, scope_a):
    store = backend.open(scope_a)
    epoch = store.runtime.begin_epoch(instance_id="room-policy")
    session_id = local_session_id("default", "user-1", "req-1")
    binding = make_binding(session_id, route="room", policy={"source": "bot_room"})
    store.bindings.reserve(epoch=epoch, binding=binding, owner=None)
    policy = {**binding.policy, "model": "next", "config_json": '{"model": {"provider": "next-provider"}}'}
    store.runtime.apply_room_model_policy(epoch, session_id, binding.policy, policy)
    assert store.bindings.receipt(session_id).policy == policy
    assert store.sessions.get(session_id).model == "next"
    assert store.sessions.get(session_id).model_config["provider"] == "next-provider"
    assert store.runtime.selection_fence(session_id)[1] == 1
    with pytest.raises(AuthorityRefusal, match="revision_conflict"):
        store.runtime.apply_room_model_policy(epoch, session_id, binding.policy, {**policy, "model": "raced"})
    assert store.sessions.get(session_id).model == "next"


@pytest.mark.platforms("linux")
@pytest.mark.parametrize("kind", ["turn", "compression"])
def test_repository_reclaims_a_killed_unreaped_holder_without_losing_the_successor_fence(backend, scope_a, kind):
    store = backend.open(scope_a)
    store.sessions.create(NewSession("zombie", "cli"))
    acquire = {
        "turn": store.coordination.try_acquire_turn_lease,
        "compression": store.coordination.try_acquire_compression_lock,
    }[kind]
    proc = subprocess.Popen([sys.executable, "-c", "import sys; sys.stdin.buffer.read()"], stdin=subprocess.PIPE)
    holder = f"pid={proc.pid}{holder_namespace_token()}:turn=killed"
    successor = f"pid={os.getpid()}{holder_namespace_token()}:turn=next"
    try:
        assert acquire(session_id="zombie", holder=holder, ttl_seconds=300)
        assert not acquire(session_id="zombie", holder=successor, ttl_seconds=300)
        proc.kill()
        os.waitid(os.P_PID, proc.pid, os.WEXITED | os.WNOWAIT)
        assert psutil.Process(proc.pid).status() == psutil.STATUS_ZOMBIE
        assert acquire(session_id="zombie", holder=successor, ttl_seconds=300)
        assert not acquire(session_id="zombie", holder=holder, ttl_seconds=300)
    finally:
        if proc.returncode is None:
            proc.kill()
        proc.wait(timeout=10)
        proc.stdin.close()
