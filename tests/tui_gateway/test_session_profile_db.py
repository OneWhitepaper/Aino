"""Session-scoped transcript ops must resolve against the session's own DB.

App-global remote mode gives a session its own profile (``profile_home`` on
the session dict, see ``session.create``), and that profile keeps its own
``state.db``.  ``_get_db()`` is the *launch* profile's handle, so any
session-scoped read or write that reaches for it operates on the wrong
database: writes land in a foreign profile under this session's id, and reads
come back empty because the row simply is not there.

``_session_db(session)`` is the profile-aware resolver that already exists for
exactly this (``tui_gateway/server.py``): the profile's ``state.db`` when
``session['profile_home']`` is set, otherwise the shared launch handle.

Every test here drives the real JSON-RPC entry point
(``server.handle_request``).  Handler bodies live in ``tui_gateway/methods_*``
but are rebound onto ``server.py``'s globals by
``method_ctx.HandlerRegistry.install()``, so calling a handler function
directly would bypass the path the gateway actually executes.
"""

from __future__ import annotations

import importlib
import threading
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from hermes_state import SessionDB

SESSION_ID = "sid-profile"
SESSION_KEY = "tui-profile-1"


@pytest.fixture()
def hermes_home(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    yield home


@pytest.fixture()
def server(hermes_home):
    # Mocks are scoped to the initial import only (see
    # tests/tui_gateway/test_protocol.py for the rationale).
    with patch.dict(
        "sys.modules",
        {
            "hermes_cli.env_loader": MagicMock(),
            "hermes_cli.banner": MagicMock(),
        },
    ):
        mod = importlib.import_module("tui_gateway.server")

    methods = dict(mod._methods)
    yield mod
    # Restore in place instead of clear+reload: importlib.reload re-registers
    # atexit hooks and re-captures module-level paths against this test's
    # soon-deleted tmpdir (see tests/tui_gateway/test_undo_command.py).
    mod._methods.clear()
    mod._methods.update(methods)
    mod._sessions.clear()
    __import__("tui_gateway.server_requests", fromlist=["x"]).reset_for_tests()
    mod._db = None


@pytest.fixture()
def launch_db(server, hermes_home):
    """The launch profile's state.db, wired in as the ``_get_db()`` handle."""
    db = SessionDB(db_path=hermes_home / "state.db")
    server._db = db
    return db


@pytest.fixture()
def profile_db(tmp_path):
    """A second, non-launch profile's state.db."""
    profile_home = tmp_path / "profiles" / "work"
    profile_home.mkdir(parents=True)
    return profile_home, SessionDB(db_path=profile_home / "state.db")


def _seed(db, turns=3, *, _capture_user_row_ids=None):
    db.create_session(SESSION_KEY, source="tui")
    for i in range(1, turns + 1):
        uid = db.append_message(SESSION_KEY, "user", f"question {i}")
        if _capture_user_row_ids is not None:
            _capture_user_row_ids.append(uid)
        db.append_message(SESSION_KEY, "assistant", f"answer {i}")
    return db.get_messages_as_conversation(SESSION_KEY)


def _register(server, history, *, profile_home=None):
    # SimpleNamespace, not MagicMock: the usage snapshot compares attributes
    # numerically, and auto-created mock attributes are not orderable.
    agent = types.SimpleNamespace(
        _memory_manager=MagicMock(),
        _last_flushed_db_idx=len(history),
        model="test-model",
    )
    session = {
        "session_key": SESSION_KEY,
        "history": list(history),
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": False,
        "agent": agent,
        "attached_images": [],
        "image_counter": 0,
        "cols": 120,
        # The cap slot is claimed on the first real turn; pre-claim it so the
        # test exercises the transcript path rather than the lease allocator.
        "active_session_lease": object(),
    }
    if profile_home is not None:
        session["profile_home"] = str(profile_home)
    server._sessions[SESSION_ID] = session
    return session


def _rpc(server, method, params):
    return server.handle_request({"id": "1", "method": method, "params": params})


def _texts(rows):
    out = []
    for row in rows:
        content = row.get("content")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            )
        out.append(str(content or ""))
    return out


# ---------------------------------------------------------------------------
# /undo — command.dispatch
# ---------------------------------------------------------------------------


def test_undo_rewinds_the_profile_transcript(server, launch_db, profile_db):
    """/undo on a profile session must read and rewind that profile's db.

    ``list_recent_user_messages`` is session-id scoped, so against the launch
    handle it finds nothing and /undo fails closed with 4018 — the command is
    unusable for the entire session in app-global remote mode.
    """
    profile_home, pdb = profile_db
    history = _seed(pdb)
    _register(server, history, profile_home=profile_home)

    resp = _rpc(
        server,
        "command.dispatch",
        {"session_id": SESSION_ID, "name": "undo", "arg": ""},
    )

    assert not resp.get("error"), f"/undo failed: {resp.get('error')}"
    result = resp["result"]
    assert result["type"] == "prefill"
    assert result["message"] == "question 3"
    # The rewind is durable in the profile's own db, not the launch one.
    assert _texts(pdb.get_messages_as_conversation(SESSION_KEY)) == [
        "question 1",
        "answer 1",
        "question 2",
        "answer 2",
    ]
    assert launch_db.get_messages_as_conversation(SESSION_KEY) == []


def test_undo_still_uses_the_shared_handle_without_a_profile(server, launch_db):
    """A launch-profile session keeps borrowing the shared ``_get_db()`` handle."""
    history = _seed(launch_db)
    _register(server, history)

    resp = _rpc(
        server,
        "command.dispatch",
        {"session_id": SESSION_ID, "name": "undo", "arg": ""},
    )

    assert not resp.get("error"), f"/undo failed: {resp.get('error')}"
    assert resp["result"]["message"] == "question 3"
    assert _texts(launch_db.get_messages_as_conversation(SESSION_KEY)) == [
        "question 1",
        "answer 1",
        "question 2",
        "answer 2",
    ]


# ---------------------------------------------------------------------------
# edit/resend truncation — prompt.submit
# ---------------------------------------------------------------------------


def _stop_after_truncate(server, monkeypatch):
    """Return the RPC right after the truncate branch, before the agent turn.

    Isolated turns hand the prompt to the compute host and return, which is
    the natural exit closest to the code under test; stubbing the handoff keeps
    the test on the transcript-persistence path instead of running a model.
    """
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a, **k: True)
    monkeypatch.setattr(
        server,
        "_submit_prompt_to_compute_host",
        lambda rid, sid, session, text, **_kwargs: server._ok(
            rid, {"status": "streaming"}
        ),
    )


def test_truncation_persists_to_the_profile_db(server, launch_db, profile_db, monkeypatch):
    """An edit/resend must truncate the profile's transcript, not the launch one."""
    profile_home, pdb = profile_db
    user_row_ids: list = []
    history = _seed(pdb, _capture_user_row_ids=user_row_ids)
    _register(server, history, profile_home=profile_home)
    _stop_after_truncate(server, monkeypatch)

    # Row-id addressed, not ordinal-only: current main refuses a bare ordinal
    # for a durable session (truncate_before_row_id required). Target the 2nd
    # user turn's durable row id; keep the matching ordinal as a cross-check.
    resp = _rpc(
        server,
        "prompt.submit",
        {
            "session_id": SESSION_ID,
            "text": "edited question 2",
            "truncate_before_row_id": user_row_ids[1],
            "truncate_before_user_ordinal": 1,
            "confirm_truncate": True,
            "confirm_deep_truncate": True,  # cuts 2 of 3 user turns (#133716)
        },
    )

    assert not resp.get("error"), f"prompt.submit failed: {resp.get('error')}"
    # The undone turns are gone from the profile's own db, so session.resume
    # (which opens the profile db correctly) cannot resurrect them.
    assert _texts(pdb.get_messages_as_conversation(SESSION_KEY)) == [
        "question 1",
        "answer 1",
    ]
    # ...and nothing was copied into a foreign profile under this session id.
    assert launch_db.get_messages_as_conversation(SESSION_KEY) == []


def test_truncation_does_not_copy_rows_into_the_launch_profile(
    server, launch_db, profile_db, monkeypatch
):
    """The launch profile must not receive a copy of a profile session's turns.

    When the launch db happens to hold a row under the same session id, the
    write through the launch handle succeeds instead of failing the foreign-key
    check, so the truncated transcript is inserted into a profile the session
    does not belong to.
    """
    profile_home, pdb = profile_db
    user_row_ids: list = []
    history = _seed(pdb, _capture_user_row_ids=user_row_ids)
    launch_db.create_session(SESSION_KEY, source="unknown")
    _register(server, history, profile_home=profile_home)
    _stop_after_truncate(server, monkeypatch)

    resp = _rpc(
        server,
        "prompt.submit",
        {
            "session_id": SESSION_ID,
            "text": "edited question 2",
            "truncate_before_row_id": user_row_ids[1],
            "truncate_before_user_ordinal": 1,
            "confirm_truncate": True,
            "confirm_deep_truncate": True,  # cuts 2 of 3 user turns (#133716)
        },
    )

    assert not resp.get("error"), f"prompt.submit failed: {resp.get('error')}"
    assert launch_db.get_messages_as_conversation(SESSION_KEY) == []
    assert _texts(pdb.get_messages_as_conversation(SESSION_KEY)) == [
        "question 1",
        "answer 1",
    ]


def test_truncation_surfaces_the_profile_dbs_live_row_ids(
    server, launch_db, profile_db, monkeypatch
):
    """``survivor_user_row_ids`` must carry the profile db's live ids.

    The client rebinds its cached stamps from this payload, so the ids have to
    come from the db that did the rewrite. Since #82956 the kept prefix keeps its
    rows (only the dropped suffix is archived), so those ids are the ORIGINAL ones.
    """
    profile_home, pdb = profile_db
    user_row_ids: list = []
    history = _seed(pdb, _capture_user_row_ids=user_row_ids)
    _register(server, history, profile_home=profile_home)
    _stop_after_truncate(server, monkeypatch)

    resp = _rpc(
        server,
        "prompt.submit",
        {
            "session_id": SESSION_ID,
            "text": "edited question 2",
            "truncate_before_row_id": user_row_ids[1],
            "truncate_before_user_ordinal": 1,
            "confirm_truncate": True,
            "confirm_deep_truncate": True,  # cuts 2 of 3 user turns (#133716)
        },
    )

    assert not resp.get("error"), f"prompt.submit failed: {resp.get('error')}"
    surviving = [
        row["_row_id"]
        for row in pdb.get_messages_as_conversation(SESSION_KEY, include_row_ids=True)
        if row["role"] == "user"
    ]
    assert resp["result"]["survivor_user_row_ids"] == surviving
    # The kept prefix keeps its rows: the pre-rewind id stays valid (#82956).
    assert surviving == [user_row_ids[0]]


def test_truncation_without_a_profile_uses_the_shared_handle(server, launch_db, monkeypatch):
    user_row_ids: list = []
    history = _seed(launch_db, _capture_user_row_ids=user_row_ids)
    _register(server, history)
    _stop_after_truncate(server, monkeypatch)

    resp = _rpc(
        server,
        "prompt.submit",
        {
            "session_id": SESSION_ID,
            "text": "edited question 2",
            "truncate_before_row_id": user_row_ids[1],
            "truncate_before_user_ordinal": 1,
            "confirm_truncate": True,
            "confirm_deep_truncate": True,  # cuts 2 of 3 user turns (#133716)
        },
    )

    assert not resp.get("error"), f"prompt.submit failed: {resp.get('error')}"
    assert _texts(launch_db.get_messages_as_conversation(SESSION_KEY)) == [
        "question 1",
        "answer 1",
    ]


# ---------------------------------------------------------------------------
# /history and /context — slash.exec
# ---------------------------------------------------------------------------


def test_history_reads_the_profile_transcript(server, launch_db, profile_db):
    """/history must render the profile session's own transcript."""
    profile_home, pdb = profile_db
    _seed(pdb)
    # In-memory history is deliberately empty: the point of the db read is to
    # rebuild the transcript for a session the process did not run itself.
    _register(server, [], profile_home=profile_home)

    resp = _rpc(server, "slash.exec", {"session_id": SESSION_ID, "command": "/history"})

    assert not resp.get("error"), f"/history failed: {resp.get('error')}"
    output = resp["result"]["output"]
    assert "question 3" in output
    assert "answer 3" in output


def test_context_reads_the_profile_transcript(server, launch_db, profile_db, monkeypatch):
    """/context must count the profile session's own messages."""
    profile_home, pdb = profile_db
    _seed(pdb)
    _register(server, [], profile_home=profile_home)
    # /context is an isolated-session read command, gated on the compute host.
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a, **k: True)

    resp = _rpc(server, "slash.exec", {"session_id": SESSION_ID, "command": "/context"})

    assert not resp.get("error"), f"/context failed: {resp.get('error')}"
    output = resp["result"]["output"]
    assert "Conversation: 6 messages" in output
    assert "user: 3, assistant: 3" in output


def _seed_context_anchor(db, prompt_tokens, *, tail=False, include_system=False):
    from agent.usage_anchor import USAGE_ANCHOR_MODEL_CONFIG_KEY, capture_usage_anchor

    db.create_session(SESSION_KEY, source="desktop")
    db.append_message(SESSION_KEY, "user", f"profile-specific question {prompt_tokens}")
    priced = db.get_messages_as_conversation(SESSION_KEY)
    if include_system:
        priced = [{"role": "system", "content": "stable system prompt"}, *priced]
        db.update_system_prompt(SESSION_KEY, "stable system prompt")
    anchor = capture_usage_anchor(prompt_tokens, 30, priced)
    db.patch_session_model_config(SESSION_KEY, {USAGE_ANCHOR_MODEL_CONFIG_KEY: anchor})
    db.append_message(SESSION_KEY, "assistant", "the already-priced reply")
    if tail:
        db.append_message(SESSION_KEY, "user", "new material not yet priced by the provider")
    return db.get_messages_as_conversation(SESSION_KEY)


def test_cold_context_reuses_profile_anchor_a_b_a_without_rereading_history(
        server, launch_db, profile_db, monkeypatch):
    from agent.model_metadata import estimate_messages_tokens_rough
    from agent.secret_scope import is_multiplex_active, set_multiplex_active
    from agent.usage_anchor import USAGE_ANCHOR_MODEL_CONFIG_KEY

    profile_home, pdb = profile_db
    first = _register(server, _seed_context_anchor(launch_db, 300, include_system=True))
    first.update(agent=None, model_override={"model": "profile-a-model"})
    second = _register(server, _seed_context_anchor(pdb, 900, tail=True, include_system=True), profile_home=profile_home)
    second.update(agent=None, model_override={"model": "profile-b-model"})
    server._sessions["cold-a"] = first
    server._sessions["cold-b"] = second
    reads = []
    original = SessionDB.get_session_model_config_value

    def counted(db, session_id, key, default=None):
        if key == USAGE_ANCHOR_MODEL_CONFIG_KEY:
            reads.append(str(db.db_path))
        return original(db, session_id, key, default)

    def no_second_history_read(*args, **kwargs):
        raise AssertionError("cold context must reuse the existing hydration instead of rereading all messages")

    monkeypatch.setattr(SessionDB, "get_session_model_config_value", counted)
    monkeypatch.setattr(SessionDB, "get_messages_as_conversation", no_second_history_read)
    was_multiplex = is_multiplex_active()
    set_multiplex_active(True)
    try:
        for sid, expected, source, model in (
            ("cold-a", 330, "provider_usage", "profile-a-model"),
            ("cold-b", 930 + estimate_messages_tokens_rough(second["history"][2:]),
             "provider_usage_plus_estimate", "profile-b-model"),
            ("cold-a", 330, "provider_usage", "profile-a-model"),
        ):
            response = _rpc(server, "session.context_breakdown", {"session_id": sid})
            assert "error" not in response, response
            usage = response["result"]
            assert usage["context_used"] == expected
            assert usage["context_source"] == source
            assert usage["context_estimated"] is (source != "provider_usage")
            assert usage["model"] == model
        assert reads.count(str(launch_db.db_path)) == 1
        assert reads.count(str(pdb.db_path)) == 1
    finally:
        set_multiplex_active(was_multiplex)


def test_cold_context_rejects_stale_anchor_and_preserves_compute_host_authority(server, launch_db, monkeypatch):
    session = _register(server, _seed_context_anchor(launch_db, 300))
    session.update(agent=None, model_override={"model": "local-model"})
    session.update(history=[], resume_hydrating=True, resume_history_ready=threading.Event(),
                   agent_ready=threading.Event())
    waiting = _rpc(server, "session.context_breakdown", {"session_id": SESSION_ID})["result"]
    assert waiting["context_source"] == "unknown"
    events, hydrated = [], threading.Event()
    monkeypatch.setattr(server, "_emit", lambda kind, sid, payload: events.append((kind, sid, payload)))
    monkeypatch.setattr(server, "_start_agent_build", lambda *args: hydrated.set())
    monkeypatch.setattr(server, "_maybe_schedule_auto_continue", lambda *args: None)
    server._schedule_resume_hydration(SESSION_ID, SESSION_KEY, launch_db)
    assert hydrated.wait(5), events
    usage_events = [payload for kind, sid, payload in events if kind == "session.usage" and sid == SESSION_ID]
    assert len(usage_events) == 1
    assert usage_events[0]["usage"]["context_used"] == 330
    assert usage_events[0]["usage"]["context_source"] == "provider_usage"
    assert _rpc(server, "session.context_breakdown", {"session_id": SESSION_ID})["result"]["context_used"] == 330

    # A rewind can preserve list length. The version invalidates the cached figure,
    # and the persisted fingerprint must reject the replaced priced message.
    with session["history_lock"]:
        session["history"][0] = {"role": "user", "content": "rewritten question"}
        session["history_version"] += 1
    stale = _rpc(server, "session.context_breakdown", {"session_id": SESSION_ID})["result"]
    assert stale["context_source"] == "unknown"
    assert stale["context_used"] == 0

    session.update(_compute_host_active=True, _metadata_mirror={"model": "host-model", "usage": {
        "context_used": 470, "context_max": 1_000, "context_percent": 47,
        "context_source": "provider_usage", "context_estimated": False}})
    mirrored = _rpc(server, "session.context_breakdown", {"session_id": SESSION_ID})["result"]
    assert mirrored["context_used"] == 470
    assert mirrored["context_max"] == 1_000
    assert mirrored["context_percent"] == 47
    assert mirrored["context_source"] == "provider_usage"
    assert mirrored["model"] == "host-model"
    session["agent"] = object()  # A parked local agent cannot override the active compute host.
    assert _rpc(server, "session.context_breakdown", {"session_id": SESSION_ID})["result"] == mirrored
    session["agent"] = None
    session["_compute_host_active"] = False
    assert _rpc(server, "session.context_breakdown", {"session_id": SESSION_ID})["result"] == mirrored
