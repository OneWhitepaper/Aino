"""An asynchronous activity remains owned by the turn that commissioned it."""
from __future__ import annotations

import contextvars
import threading

from tui_gateway import event_replay, server_requests


def _session(turn_id, generation=1):
    return {
        "_conversation_binding": {"conversation_id": "c1", "participant_id": "a",
                                  "session_generation": generation},
        "_hosted_room_task": {"room_id": "c1", "turn_id": turn_id, "task_id": "task-" + turn_id,
                              "execution_generation": 2, "member_id": "a"},
    }


def test_delayed_worker_events_and_replay_keep_original_turn(monkeypatch):
    from tui_gateway.conversation_activity import (
        attach_conversation_activity, capture_conversation_activity, conversation_activity_scope,
    )
    session = _session("old")
    origin = capture_conversation_activity("runtime-a", session)
    ready, release = threading.Event(), threading.Event()
    frames = []

    def emit(text):
        frame = {"method": "event", "params": {"session_id": "runtime-a", "type": "message.delta",
                  "payload": {"text": text}}}
        attach_conversation_activity(frame)
        event_replay._stamp_event(frame)
        frames.append(frame)

    def worker():
        ready.set()
        assert release.wait(5)
        emit("old result")

    event_replay.reset_replay_state()
    with conversation_activity_scope(origin):
        ctx = contextvars.copy_context()
    thread = threading.Thread(target=lambda: ctx.run(worker))
    thread.start()
    try:
        assert ready.wait(5)
        session["_hosted_room_task"] = _session("new")["_hosted_room_task"]
        with conversation_activity_scope(capture_conversation_activity("runtime-a", session)):
            emit("new result")
        release.set()
        thread.join(timeout=5)
        assert not thread.is_alive()
        replay = event_replay.events_since("runtime-a", 0)
        assert [(e["conversation"]["turn_id"], e["payload"]["text"]) for e in replay] == [
            ("new", "new result"), ("old", "old result")]
        assert replay[0]["seq"] < replay[1]["seq"]
        # A thread without origin evidence must not borrow whatever turn is selected now.
        emit("unattributed")
        assert "conversation" not in frames[-1]["params"]
        with conversation_activity_scope(origin):
            foreign = {"method": "event", "params": {"session_id": "another-runtime"}}
            attach_conversation_activity(foreign)
            assert "conversation" not in foreign["params"]
    finally:
        release.set()
        thread.join(timeout=5)
        event_replay.reset_replay_state()


def test_pending_request_replay_and_cancel_keep_origin_and_original_request_id(monkeypatch):
    from tui_gateway.conversation_activity import (
        attach_conversation_activity, capture_conversation_activity, conversation_activity_scope,
    )
    frames, results = [], []

    def write(frame):
        attach_conversation_activity(frame)
        frames.append(frame)

    def emit(kind, sid, payload):
        write({"method": "event", "params": {"type": kind, "session_id": sid, "payload": payload}})

    monkeypatch.setattr(server_requests, "_write", write)
    monkeypatch.setattr(server_requests, "_emit", emit)
    server_requests.reset_for_tests()
    origin = capture_conversation_activity("runtime-a", _session("original"))
    try:
        with conversation_activity_scope(origin):
            settle = server_requests.send_async("sudo", "runtime-a", {}, results.append)
        opened = frames[0]
        pending = server_requests.open_requests("runtime-a")
        assert pending[0]["id"] == opened["id"]
        assert pending[0]["params"]["conversation"] == opened["params"]["conversation"]
        with conversation_activity_scope(capture_conversation_activity("runtime-a", _session("later"))):
            settle("interrupted")
        cancelled = frames[-1]["params"]
        assert cancelled["payload"]["id"] == opened["id"]
        assert cancelled["conversation"]["turn_id"] == "original"
        assert not server_requests.resolve_response({"id": opened["id"], "result": {"value": "late"}})
        assert results == []
    finally:
        server_requests.reset_for_tests()


def test_managed_request_answers_and_clarify_locks_require_attached_owner(monkeypatch):
    from tui_gateway import server
    from tui_gateway.conversation_activity import capture_conversation_activity, conversation_activity_scope
    from tui_gateway.transport import FanoutTransport, bind_transport, reset_transport

    class Peer:
        def __init__(self, user):
            self.auth_identity = {"provider": "test", "user_id": user}

        def write(self, frame):
            return True

    owner, mirror, stranger, viewer = Peer("owner"), Peer("owner"), Peer("stranger"), Peer("owner")
    viewer.auth_identity["read_only"] = True
    session = _session("original")
    session["transport"] = FanoutTransport(owner, mirror, viewer)
    session["_conversation_binding"]["auth_user_id"] = "test:owner"
    monkeypatch.setattr(server, "_sessions", {"runtime-a": session})
    monkeypatch.setattr(server_requests, "_write", lambda frame: None)
    monkeypatch.setattr(server_requests, "_emit", lambda *args: None)
    server_requests.reset_for_tests()
    results = []
    with conversation_activity_scope(capture_conversation_activity("runtime-a", session)):
        settle = server_requests.send_async("sudo", "runtime-a", {}, results.append)
        question = server_requests.ServerRequest("runtime-a", "clarify", {
            "questions": [{"qid": "q1", "question": "Continue?"}]}, qids=["q1"])
        server_requests._register(question)
    sudo = server_requests.open_requests("runtime-a")[0]
    try:
        token = bind_transport(stranger)
        try:
            assert not server_requests.resolve_response({"id": sudo["id"], "result": {"value": "no"}})
            assert server_requests.lock_answer(question.id, "q1", "no") is None
            assert question.locked == {}
            assert server._methods["request.answer"]("foreign", {
                "id": sudo["id"], "result": {"value": "no"}})["result"]["status"] == "expired"
        finally:
            reset_transport(token)
        token = bind_transport(viewer)
        try:
            assert not server_requests.resolve_response({"id": sudo["id"], "result": {"value": "no"}})
            assert server_requests.lock_answer(question.id, "q1", "no") is None
            assert question.locked == {}
        finally:
            reset_transport(token)
        token = bind_transport(mirror)
        try:
            assert server_requests.resolve_response({"id": sudo["id"], "result": {"value": "yes"}})
            assert server_requests.lock_answer(question.id, "q1", "yes") == []
            assert results == [{"value": "yes"}]
            assert question.result == {"answers": {"q1": "yes"}}
        finally:
            reset_transport(token)
    finally:
        settle("test_done")
        server_requests.reset_for_tests()


def test_usage_ticker_carries_original_activity_after_parent_context_exits(monkeypatch):
    from tui_gateway import server
    from tui_gateway.conversation_activity import capture_conversation_activity, conversation_activity_scope
    sampled, release, emitted = threading.Event(), threading.Event(), threading.Event()
    frames = []
    samples = 0

    def usage(_agent):
        nonlocal samples
        samples += 1
        if samples > 1:
            sampled.set()
            assert release.wait(5)
        return {"input_tokens": samples}

    class Sink:
        def write(self, frame):
            frames.append(frame)
            emitted.set()
            return True

    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(server, "_stdio_transport", Sink())
    monkeypatch.setattr(server, "_get_usage", usage)
    with conversation_activity_scope(capture_conversation_activity("runtime-a", _session("original"))):
        stop, thread = server._start_usage_ticker("runtime-a", object(), interval=0.01)
    try:
        assert sampled.wait(5)
        with conversation_activity_scope(capture_conversation_activity("runtime-a", _session("later"))):
            release.set()
            assert emitted.wait(5)
        assert frames[0]["params"]["type"] == "session.usage"
        assert frames[0]["params"]["conversation"]["turn_id"] == "original"
    finally:
        stop.set()
        release.set()
        thread.join(timeout=5)
        assert not thread.is_alive()
