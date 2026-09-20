"""Session creation, durable seeding, and profile-owned resume paths.

Registered through the existing server-global binding to share ownership,
transport, and lifecycle state with the gateway handlers.
"""

from __future__ import annotations

from .method_ctx import bind_module

def _hydrate_session_cwd(sid: str, key: str, session_db, profile_home: str | None) -> None:
    """Adopt the stored row's cwd, or persist the fresh session's cwd (+ schedule git meta) when the row has none."""
    owns_db, db = False, session_db
    if db is None and not profile_home:
        db = _get_db()
    elif db is None:
        try:
            db = _open_profile_session_db(profile_home)
            owns_db = True
        except Exception:
            # FAIL CLOSED (as the deferred-build bind): a named-profile session must never touch the launch
            # state.db — skip hydration (the row lands on the agent's own lazy-create once the store recovers).
            logger.warning("profile session store unavailable for %s — skipping cwd hydration instead of "
                           "touching the launch state.db", profile_home, exc_info=True)
    try:
        if db is not None:
            row = db.get_session(key) if hasattr(db, "get_session") else None
            if row and row.get("cwd"):
                with _sessions_lock:
                    if sid in _sessions:
                        _sessions[sid]["cwd"] = row["cwd"]
            elif hasattr(db, "update_session_cwd"):
                try:
                    _persist_session_cwd_and_schedule_git_meta(_sessions[sid], _sessions[sid]["cwd"], db=db)
                except Exception:
                    logger.debug("failed to persist resumed session cwd", exc_info=True)
    finally:
        if owns_db and db is not None:
            with contextlib.suppress(Exception):
                db.close()


def _init_session(
    sid: str, key: str, agent, history: list, cols: int = 80, cwd: str | None = None,
    session_db=None, source: str | None = None, profile_home: str | None = None,
    explicit_cwd: bool = False):
    now = time.time()
    with _sessions_lock:
        _sessions[sid] = {
            "agent": agent, "session_key": key, "history": history, "history_lock": threading.Lock(),
            "history_version": 0, "inflight_turn": None, "created_at": now, "last_active": now,
            "running": False, "attached_images": [], "image_counter": 0, "cwd": cwd or _completion_cwd(),
            "explicit_cwd": bool(explicit_cwd), "cols": cols, "slash_worker": None,
            "show_reasoning": _load_show_reasoning(), "source": _resolve_session_source(source),
            "tool_progress_mode": _load_tool_progress_mode(), "edit_snapshots": {}, "tool_started_at": {},
            # Profile-scoped HERMES_HOME (None = launch); SessionBranch copies the parent's (same state.db).
            "profile_home": profile_home,
            # In-session /model switch, honored on rebuild (/new, resume) — never leaks to siblings via env vars.
            "model_override": None,
            # Async events go to the transport that created the session (stdio for Ink, WS for the dashboard).
            "transport": current_transport() or _stdio_transport,
            "auth_user_id": _transport_auth_user_id(current_transport()),
        }
        _session_todo_state(_sessions[sid])
    _hydrate_session_cwd(sid, key, session_db, profile_home)
    _register_session_cwd(_sessions[sid])
    _wire_session_agent(sid, key, agent)  # no eager slash-worker pre-warm (see _start_agent_build)
    _start_session_services(sid, key, _sessions.get(sid, {}))
    _emit("session.info", sid, _session_info(agent, _sessions.get(sid, {})))
    _schedule_mcp_late_refresh(sid, agent)


def _lazy_resume_info(cwd: str, *, model: str = "", provider: str = "", profile: str | None = None) -> dict:
    """session.info for a not-yet-built session (session.create's shape); tools/skills land with the deferred build."""
    return {
        "cwd": cwd, "branch": git_probe.branch(cwd), "project": _project_info_for_cwd(cwd),
        "model": model or _resolve_model(), "tools": {}, "skills": {}, "lazy": True,
        "desktop_contract": DESKTOP_BACKEND_CONTRACT, "profile_name": _response_profile_name(profile),
        "capabilities": {"managed_model_binding": 1},
        **({"provider": provider} if provider else {}),
    }


def _deferred_session_record(
    session_key: str, *, cols: int, cwd: str, history: list, lease, source: str = "tui",
    close_on_disconnect: bool = False, display_history_prefix: list | None = None,
    profile_home: Path | None = None, lazy: bool = False, model_override=None,
    resume_runtime_overrides: dict | None = None, todo_state: dict | None = None,
    explicit_cwd: bool = False, managed_model_params: dict | None = None) -> dict:
    """A live-session record whose AIAgent is built later (lazy watch / cold resume) — _init_session's shape minus the agent."""
    now = time.time()
    return {
        "agent": None, "agent_error": None, "agent_ready": threading.Event(), "attached_images": [],
        "close_on_disconnect": close_on_disconnect, "active_session_lease": lease, "cols": cols,
        "created_at": now, "cwd": cwd, "display_history_prefix": display_history_prefix or [],
        "edit_snapshots": {}, "explicit_cwd": bool(explicit_cwd), "history": history,
        "history_lock": threading.Lock(), "history_version": 0, "image_counter": 0,
        "inflight_turn": None, "last_active": now, "lazy": lazy, "model_override": model_override,
        "pending_title": None,
        "profile_home": str(profile_home) if profile_home is not None else None,
        "resume_runtime_overrides": resume_runtime_overrides, "resume_session_id": session_key,
        "managed_model_params": managed_model_params,
        "running": False, "session_key": session_key, "show_reasoning": _load_show_reasoning(),
        "slash_worker": None, "source": source, "tool_progress_mode": _load_tool_progress_mode(),
        "tool_started_at": {}, "todo_state": todo_state,
        "transport": current_transport() or _stdio_transport,
        "auth_user_id": _transport_auth_user_id(current_transport()),
    }


def _seed_branch_row(record: dict, key: str, parent_session_id: str, history: list, source: str, profile_home):
    """Persist a seeded desktop branch child NOW (the one session.create exception to lazy rows): the
    renderer's post-create resume re-fetches it via REST/defer_history, so an unpersisted child 404s and
    the fail-latch spins forever. Best-effort — on failure the lazy first-prompt path is the fallback."""
    try:
        with _session_db(record) as db:
            if db is None:
                return
            _persist_branch(db, key, parent_session_id, _branch_title(db, parent_session_id), history,
                            source=source, cwd=record["cwd"],
                            profile_name=profile_name_for_home(profile_home) or _current_profile_name(), compensate=True,
                            runtime_metadata=_workdir_row_model_config(record)[1])
            record["pending_title"] = None
            # The first submit's _persist_branch_seed is the fallback for a failed seed, not a second copy.
            record["_branch_seed_persisted"] = True
    except Exception:
        logger.warning("seeded-branch persistence failed for %s; falling back to lazy row creation", key,
                       exc_info=True)


def _seed_row(record: dict) -> None:
    """Persist a parentless seeded session NOW, for the reason ``_seed_branch_row`` gives: seeded content is
    intent, not an abandoned draft, and the renderer's post-create hydration reads the DB. The client's title
    lands with the row so a restart before the first prompt keeps it. Best-effort — the first-prompt path is
    the fallback, and it re-copies the WHOLE seed, so a partial copy is rolled back here (the compensation
    ``_persist_branch`` applies to branch children) rather than left to be duplicated."""
    key = record.get("session_key")
    try:
        if _ensure_session_db_row(record) is False:
            return
        _persist_branch_seed(record)
    except Exception:
        logger.warning("seeded-session persistence failed for %s; falling back to lazy row creation", key, exc_info=True)
    if not record.get("_branch_seed_persisted"):
        with contextlib.suppress(Exception), _session_db(record) as db:
            if db is not None:
                db.delete_session(key)
        return
    try:
        if title := record.get("pending_title"):
            with _session_db(record) as db:
                if db is not None and db.set_session_title(key, title):
                    record["pending_title"] = None
    except Exception:
        logger.debug("seeded-session title write failed for %s; pending_title stays queued", key, exc_info=True)


def _create_overrides(params: dict) -> tuple:
    """PER-SESSION (model, reasoning, service_tier) overrides from the composer — never a global config
    write. ``fast`` presence is the contract: omitted inherits, true pins priority, false pins normal ("").

    Also extracts managed model parameters: model_source and model_id for platform models."""
    create_model = _str_param(params, "model")
    model_source = _str_param(params, "model_source") or None
    model_id = _str_param(params, "model_id") or None
    if model_source == "aino" and (not model_id or len(model_id) > 128):
        raise ValueError("platform model_id required")

    model_override = None
    managed_model_params = None

    # Platform models: store model_source and model_id for lazy binding
    if model_source == "aino" and model_id:
        managed_model_params = {"model_source": model_source, "model_id": model_id}
    # Traditional BYOK: store model and provider
    elif create_model:
        model_override = {"model": create_model, "provider": _str_param(params, "provider") or None}

    reasoning_override = None
    if effort := _str_param(params, "reasoning_effort"):
        with contextlib.suppress(Exception):
            from hermes_constants import parse_reasoning_effort
            reasoning_override = parse_reasoning_effort(effort)
    service_tier_override = None
    if "fast" in params:
        service_tier_override = "priority" if is_truthy_value(params.get("fast")) else ""
    return model_override, reasoning_override, service_tier_override, managed_model_params


def _create_session(rid, params: dict) -> dict:
    (sid, source), key = _new_runtime_ids(params), _new_session_key()
    history = _coerce_seed_history(params.get("messages"))
    # Branch: links back so list_sessions_rich keeps it visible and the sidebar nests it.
    parent_session_id = _str_param(params, "parent_session_id") or None
    # Only an explicitly chosen existing workspace persists as cwd; the launch-dir fallback is "No workspace".
    explicit_cwd = False
    raw_cwd = _str_param(params, "cwd")  # unguarded, as on BASE: only the path check is best-effort
    with contextlib.suppress(Exception):
        explicit_cwd = bool(raw_cwd) and os.path.isdir(os.path.abspath(os.path.expanduser(raw_cwd)))
    _enable_gateway_prompts()
    # ``profile`` (app-global remote mode): stored so the build and every turn re-bind HERMES_HOME.
    profile_home = _profile_home(profile := (params.get("profile") or "").strip() or None)
    session_model_override, create_reasoning_override, create_service_tier_override, managed_model_params = _create_overrides(params)
    if parent_session_id and managed_model_params is None and session_model_override is None:
        from .managed_session import managed_metadata
        with _session_db({"profile_home": str(profile_home) if profile_home else None}) as db:
            parent = db.get_session(parent_session_id) if db is not None else None
            managed_model_params = managed_metadata(_parse_model_config((parent or {}).get("model_config"), quiet=True))
    now = time.time()
    with _sessions_lock:
        _sessions[sid] = {
            "agent": None, "agent_error": None, "agent_ready": threading.Event(), "attached_images": [],
            "close_on_disconnect": _flag(params, "close_on_disconnect"),
            "active_session_lease": None,  # claimed lazily on the first turn (_ensure_active_session_slot)
            "cols": int(params.get("cols", 80)), "created_at": now, "edit_snapshots": {},
            "explicit_cwd": explicit_cwd,
            "history": history, "history_lock": threading.Lock(), "history_version": 0, "image_counter": 0,
            "seeded": bool(history),  # gates _persist_branch_seed: only create-time history is unpersisted
            "cwd": _completion_cwd(params), "inflight_turn": None, "last_active": now,
            "model_override": session_model_override,
            "create_reasoning_override": create_reasoning_override,
            "create_service_tier_override": create_service_tier_override,
            "managed_model_params": managed_model_params,
            "parent_session_id": parent_session_id, "pending_title": _str_param(params, "title") or None,
            "pending_hidden": _flag(params, "hidden"), "room_plumbing": _flag(params, "room_plumbing"),
            "follow_profile_config": _flag(params, "follow_profile_config"),
            "profile_home": str(profile_home) if profile_home is not None else None,
            "running": False, "session_key": key, "show_reasoning": _load_show_reasoning(), "source": source,
            "slash_worker": None, "tool_progress_mode": _load_tool_progress_mode(), "tool_started_at": {},
            "transport": current_transport() or _stdio_transport,
            "auth_user_id": _transport_auth_user_id(current_transport())}
        from .session_conversation_binding import attach_pending_conversation
        attach_pending_conversation(_sessions[sid])
        _register_session_cwd(_sessions[sid])
    # No DB row here (drafts left "Untitled" litter): created on the first prompt — except seeded sessions.
    # NOTE: we intentionally do NOT persist a DB row here. Every TUI/desktop launch (and every "New agent" /
    # draft) opens a session here just to paint the composer, so eagerly creating a row left an "Untitled"
    # empty session behind for every launch the user never typed into. The row is now created lazily on the
    # first prompt (see _ensure_session_db_row + prompt.submit), and the AIAgent's own INSERT-OR-IGNORE
    # persists it on the first turn too. EXCEPTION — seeded branch children (#93959): a desktop branch
    # carries parent_session_id AND a seeded transcript, which is explicit user intent, not an abandoned
    # draft. The row MUST exist immediately: the renderer's post-create resume re-fetches the child through
    # REST + defer_history hydration, both of which read the DB — an unpersisted child 404s, the fail-latch
    # then refuses to bind a "transcript-less" session, and the user sees an infinite spinner whose
    # optimistic row vanishes on restart. Persisting up front also means a restart keeps the branch (both
    # reports lost it) and the title lands in the parent's lineage instead of falling back to a
    # message-preview name. Title mirrors the TUI /branch naming.
    # The same holds for a seeded session WITHOUT a parent (a client opening a chat with its first turns
    # already written): the transcript exists only in memory, so a restart before the first prompt lost it
    # and the post-create resume 404'd. Persist it up front too; only empty drafts stay lazy.
    if parent_session_id and history:
        _seed_branch_row(_sessions[sid], key, parent_session_id, history, source, profile_home)
    elif history:
        _seed_row(_sessions[sid])
    # Return immediately so Ink can paint; the AIAgent builds right after the flush.
    _schedule_agent_build(sid)
    _schedule_session_cap_enforcement()  # trim detached idle sessions over the cap
    cwd = _sessions[sid]["cwd"]
    override = session_model_override or {}
    from .managed_session import model_status
    messages = _history_to_messages(history)  # hidden seed rows are not on the wire; count what is (as resume does)
    return _ok(rid, {
        "session_id": sid, "stored_session_id": key, "message_count": len(messages), "messages": messages,
        # Reflect the override now so the client doesn't clobber its sticky pick.
        "info": {"model": override.get("model") if override else _resolve_model(),
                 **({"provider": override["provider"]} if override.get("provider") else {}),
                 "tools": {}, "skills": {}, "cwd": cwd, "branch": git_probe.branch(cwd),
                 "project": _project_info_for_cwd(cwd), "lazy": True, "desktop_contract": DESKTOP_BACKEND_CONTRACT,
                 "profile_name": _response_profile_name(profile),
                 **model_status(_sessions[sid], sid)}})


class _Resume:
    """Per-call ``session.resume`` state. ``owns_db``: the DEDICATED profile handle is ours
    to close (handler ``finally``) until handed to the hydration worker or the agent."""

    def __init__(self, rid, params: dict, target: str) -> None:
        self.rid, self.params, self.target = rid, params, target
        self.db, self.owns_db, self.found, self.profile_resume_cwd = None, False, None, ""
        self.cols = _int_param(params, "cols", 80)
        # ``profile`` (app-global remote mode): resume from another local profile's state.db.
        self.profile = (params.get("profile") or "").strip() or None
        self.profile_home = _profile_home(self.profile)
        self.lazy, self.defer_history = _flag(params, "lazy"), _flag(params, "defer_history")
        # Desktop hydrates over REST; suppress the duplicate WS copy only when asked.
        self.omit_messages, self.eager_build = _flag(params, "omit_messages"), _flag(params, "eager_build")

    def mint(self, prompts: bool = True) -> tuple:
        """``(runtime sid, source, cwd)`` for the live record this resume registers (+ gateway prompts on)."""
        ids = _new_runtime_ids(self.params)
        if _parse_model_config((self.found or {}).get("model_config"), quiet=True).get("conversation_binding"):
            ids = (ids[0], str(self.found["source"]))
        if prompts:
            _enable_gateway_prompts()
        return *ids, self.profile_resume_cwd or _default_session_cwd()

    def record(self, source: str, cwd: str, history: list, overrides: dict | None = None, **extra) -> dict:
        """``_deferred_session_record`` with this resume's common fields (lease claimed lazily on turn 1);
        ``overrides`` restores the stored model/provider/reasoning/tier so the deferred build matches eager."""
        if overrides is not None:
            extra.update(model_override=overrides.get("model_override"), resume_runtime_overrides=overrides or None)
            extra["managed_model_params"] = overrides.get("managed_model_params")
        record = _deferred_session_record(
            self.target, cols=self.cols, cwd=cwd, history=history, lease=None, source=source,
            close_on_disconnect=_flag(self.params, "close_on_disconnect"),
            profile_home=self.profile_home, explicit_cwd=bool(self.profile_resume_cwd), **extra)
        from . import server
        from .session_conversation_binding import restore_conversation_session
        restore_conversation_session(server, record, self.found)
        return record

    def claim(self, sid: str, record: dict) -> dict | None:
        """Register ``record`` live under the resume lock, or reuse a concurrent winner's session."""
        live = _claim_or_reuse_live(sid, self.target, record, None)
        return None if live is None else _resume_reuse_live(self, *live)

    def restore(self):
        """``(sanitized model history, display history, raw history)`` for a cold/eager resume."""
        raw, display = self.read_history()
        return canonicalize_replay_history(raw), display, raw

    def info(self, cwd: str, overrides: dict) -> dict:
        from .managed_session import model_status
        return {**_lazy_resume_info(cwd, model=(overrides.get("model_override") or {}).get("model") or "",
                                  provider=overrides.get("provider_override") or "", profile=self.profile),
                **model_status(overrides)}

    def child_history(self, repair: bool) -> list:
        """The child's OWN conversation (no ancestors), row ids included."""
        return self.db.get_messages_as_conversation(self.target, repair_alternation=repair, include_row_ids=True)

    def messages(self, display: list) -> list:
        return [] if self.omit_messages else _history_to_messages(display)

    def read_history(self) -> tuple:
        """One lineage SELECT, two projections: model-fed copy alternation-repaired (healed once
        here instead of every turn's pre-request repair), display copy verbatim."""
        self.db.reopen_session(self.target)
        if self.omit_messages:
            return self.child_history(repair=True), []
        return self.db.get_resume_conversations(self.target)

    def display_prefix(self) -> list:
        """Ancestor display rows (model-fed history drops a dangling tool-call tail — display keeps it)."""
        return [] if self.omit_messages else self.db.get_ancestor_display_prefix(self.target)


def _find_live_unpersisted(needle: str, home) -> str:
    """Runtime sid of a live, not-yet-persisted session matched by stored key or pending title."""
    want_home = str(home) if home is not None else None
    return next((
        live_sid for live_sid, record in list(_sessions.items())
        if isinstance(record, dict) and (record.get("profile_home") or None) == want_home
        and (str(record.get("session_key") or "") == needle or (record.get("pending_title") or "") == needle)), "")


def _resume_live_unpersisted(ctx: _Resume, live_sid: str, live: dict) -> dict:
    """Reattach a LIVE lazy session with no state.db row yet (every fresh Bot Chat; a 404 here killed messaging
    for never-spoken bots). Attach the transport and cancel the armed orphan-reap Timer (a WS drop may have
    sentinel-parked the record) or it fires against this client."""
    if ctx.owns_db:
        _release_db(ctx.db)
    with _session_resume_lock:
        if (refusal := _reattach_refusal(ctx.rid, live_sid, live)) is not None:
            return refusal
        live["last_active"] = time.time()
        if (transport := current_transport()) is not None:
            with live.setdefault("history_lock", threading.Lock()):
                _rebind_live_transport(live_sid, live, transport)
        else:
            _cancel_ws_orphan_reap(live_sid)
    messages = ctx.messages(live.get("history") or [])  # count the wire, as every other resume path does
    from .managed_session import model_status
    return _ok(ctx.rid, _attach_todo_state({
        "session_id": live_sid, "stored_session_id": str(live.get("session_key") or ""),
        "message_count": len(messages), "messages": messages,
        "info": {"model": _resolve_model(), "lazy": True,
                 "profile_name": profile_name_for_home(live.get("profile_home")) or _response_profile_name(ctx.profile),
                 **model_status(live, live_sid)}}, live))


def _resume_adopt_stranded(ctx: _Resume) -> None:
    """Adopt a lineage stranded in the DEFAULT store (older builds ran a profile bot's turns on the focused
    tile's backend; unadopted it 4001s forever). Exact-id ONLY — bot titles collide; never a retired donor."""
    try:
        # Stranded-session adoption (#93296 follow-up): before session RPCs routed by their TARGET session,
        # a profile bot's turns executed on the focused tile's backend — usually default — so its canonical
        # session accumulated in the DEFAULT profile's state.db. Now that routing is correct, this
        # profile-scoped resume is the first place the fix and the stranded data collide: the id exists in
        # the default store but not here, and without adoption the same chat 4001s forever (the fix made it
        # unreachable instead of misrouted). Adopt the full lineage from the default store into this
        # profile's db, then retry the lookup. Only profile-scoped resumes reach here (owns_db); unknown ids
        # in the default store still 4007 exactly as before.
        default_db = _get_db()
        donor_row = default_db.get_session(ctx.target) if default_db is not None else None
        if not donor_row or donor_row.get("archived"):
            return
        if _parse_model_config(donor_row.get("model_config"), quiet=True).get("conversation_binding"):
            return  # Conversation ownership never migrates between Profile databases.
        adoption = ctx.db.adopt_session_lineage_from(default_db, donor_row["id"])
        if adoption.get("adopted"):
            logger.info("adopted stranded session %s (lineage of %s segment(s)) from default store into profile %s",
                        donor_row["id"],
                        len(adoption.get("imported_ids") or []) + len(adoption.get("skipped_ids") or []),
                        ctx.profile or "?")
            ctx.found = ctx.db.get_session(donor_row["id"])
            if ctx.found:
                ctx.target = ctx.found["id"]
    except Exception:
        logger.exception("stranded-session adoption failed for %s", ctx.target)


def _resume_locate(ctx: _Resume) -> dict | None:
    """Resolve ``ctx.target`` to a stored row (``ctx.found``); a dict is an early response."""
    ctx.found = ctx.db.get_session(ctx.target)
    if ctx.found:
        return None
    ctx.found = ctx.db.get_session_by_title(ctx.target)
    if ctx.found:
        ctx.target = ctx.found["id"]
        return None
    if ctx.lazy and _child_run_active(ctx.target):
        # Fresh subagent watch window: `subagent.start` relays BEFORE the child's first DB flush. Proceed lazily
        # with empty history — the live mirror streams the turn and the row exists by upgrade time.
        ctx.found = {}
        return None
    live_sid = _find_live_unpersisted(ctx.target, ctx.profile_home)
    if (live := _sessions.get(live_sid) if live_sid else None) is not None:
        return _resume_live_unpersisted(ctx, live_sid, live)
    if ctx.owns_db:
        _resume_adopt_stranded(ctx)
    return None if ctx.found else _err(ctx.rid, 4007, "session not found")


def _resume_follow_tip(ctx: _Resume) -> None:
    """Rebind a rotated-out parent id to its compression tip (resuming the original reloads the parent
    transcript and loses the post-compression reply). Skipped for lazy watch windows (exact child); Bot Chat
    follows proven compression edges only."""
    if not ctx.found or ctx.lazy:
        return
    tip = ctx.target
    with contextlib.suppress(Exception):
        from tools.bot_mode_probe import BOT_CHAT_TITLE
        if (_parse_model_config(ctx.found.get("model_config"), quiet=True).get("conversation_binding")
                or (ctx.found.get("title") or "").strip() == BOT_CHAT_TITLE):
            tip = ctx.db.get_compression_tip(ctx.target) or ctx.target
        else:
            tip = ctx.db.resolve_resume_session_id(ctx.target)
    if tip and tip != ctx.target:
        ctx.target = tip
        ctx.found = ctx.db.get_session(tip) or ctx.found


def _resume_guard(ctx: _Resume) -> dict | None:
    """Refuse a runaway transcript before any history read (sessions.max_resume_messages). Deferred /
    omit_messages / lazy paths load the TIP segment only and are guarded tip-only (a lineage count rejected
    exactly the well-compressed chats). Metadata fallback for lightweight adaptor DBs; fails OPEN on errors."""
    from hermes_state import SessionResumeTooLargeError, resolved_max_resume_messages
    tip_only = ctx.lazy or ctx.omit_messages or (ctx.defer_history and not ctx.eager_build)
    try:
        if callable(safety_check := getattr(ctx.db, "assert_resume_safe", None)):
            safety_check(ctx.target, **({"tip_only": True} if tip_only else {}))
        elif (limit := resolved_max_resume_messages()) and (n := int(ctx.found.get("message_count") or 0)) > limit:
            raise SessionResumeTooLargeError(n, limit)
    except SessionResumeTooLargeError as exc:
        return _err(ctx.rid, 4130, str(exc))
    except Exception as exc:
        logger.warning("resume safety check failed for %s (proceeding without guard): %s", ctx.target, exc)
    return None


def _resume_reuse_live(ctx: _Resume, sid: str, session: dict) -> dict:
    """Reattach an already-live session under the resume lock (held across the client-gone check,
    transport attach and reap cancel so grace expiry is atomic). _live_session_payload ATTACHES this
    caller alongside the client(s) already streaming instead of taking the slot from them."""
    with _session_resume_lock:
        return _resume_reuse_live_locked(ctx, sid, session)


def _resume_reuse_live_locked(ctx: _Resume, sid: str, session: dict) -> dict:
    """Reuse with _session_resume_lock already held (including the eager double-check)."""
    if (refusal := _reattach_refusal(ctx.rid, sid, session)) is not None:
        return refusal
    from . import server
    from .session_conversation_binding import restore_conversation_session
    restore_conversation_session(server, session, ctx.found)
    _cancel_ws_orphan_reap(sid)  # unconditionally: the fast path must never race the reap Timer
    payload = _live_session_payload(sid, session, cols=ctx.cols, touch=True, omit_messages=ctx.omit_messages,
                                    transport=current_transport() or _stdio_transport)
    payload["resumed"] = ctx.target
    if ctx.defer_history:
        payload.update(messages=[], hydrating=bool(session.get("resume_hydrating")),
                       message_count=int(session.get("resume_message_count") or payload["message_count"]))
    # A lazy watch session never owns a run loop — overlay the child-run registry.
    if session.get("agent") is None and _child_run_active(ctx.target):
        payload.update(running=True, status="streaming")
    return _ok(ctx.rid, payload)


def _resume_response(
    ctx: _Resume, sid: str, record: dict, *, info: dict, display: list = (), count_source: list | None = None,
    messages: list | None = None, message_count: int | None = None, running: bool = False,
    status: str = "idle", hydrating: bool | None = None, started_at=None, auto_continue=None,
) -> dict:
    """Common resume payload; omit_messages counts ``count_source`` (client still learns the stored size)."""
    if messages is None:
        messages = ctx.messages(display)
    if message_count is None:
        message_count = len(count_source) if ctx.omit_messages else len(messages)
    payload = {"session_id": sid, "resumed": ctx.target, "message_count": message_count, "messages": messages,
               **({"messages_omitted": ctx.omit_messages} if hydrating is None else {"hydrating": hydrating}),
               "info": info, "inflight": None, "running": running, "session_key": ctx.target,
               "started_at": record["created_at"] if started_at is None else started_at, "status": status}
    if auto_continue is not None:
        payload["auto_continue"] = auto_continue
    return _ok(ctx.rid, _attach_todo_state(payload, record))


def _resume_lazy(ctx: _Resume) -> dict:
    """Lazy/watch resume (desktop subagent windows): a live session WITHOUT an agent — the child runs
    inside the parent's turn, so the window needs stored history + a transport; prompt.submit upgrades it."""
    sid, source, cwd = ctx.mint(prompts=False)
    try:
        ctx.db.reopen_session(ctx.target)
        # repair_alternation heals a durable ``user;user`` once here.
        history = ctx.child_history(repair=True)
    except Exception as e:
        return _err(ctx.rid, 5000, f"resume failed: {e}")
    overrides = _stored_session_runtime_overrides(ctx.found)
    record = ctx.record(source, cwd, history, overrides, lazy=True, todo_state=_todo_state_from_history(history))
    if (reused := ctx.claim(sid, record)) is not None:
        return reused
    # A child mid-run emits no session events — liveness comes from the relay registry.
    running = _child_run_active(ctx.target)
    # Display uses the VERBATIM child-only projection so model-invisible rows survive; repaired ``history``
    # still feeds live replay.
    display = history
    try:
        display = ctx.child_history(repair=False)
    except Exception:
        logger.debug("child-watch display projection read failed", exc_info=True)
    return _resume_response(ctx, sid, record, info=ctx.info(cwd, overrides), display=display,
                            count_source=display, running=running, status="streaming" if running else "idle")


def _resume_deferred(ctx: _Resume) -> dict:
    """Bounded ack; the transcript hydrates in the background (the ONE history read) and pages over REST."""
    sid, source, cwd = ctx.mint()
    overrides = _stored_session_runtime_overrides(ctx.found)
    record = ctx.record(source, cwd, [], overrides)
    record.update(resume_history_ready=threading.Event(), resume_hydrating=True,
                  resume_message_count=int(ctx.found.get("message_count") or 0))
    if (reused := ctx.claim(sid, record)) is not None:
        return reused
    _schedule_resume_hydration(sid, ctx.target, ctx.db, close_db=ctx.owns_db)
    ctx.owns_db = False  # the hydration worker now owns (and closes) the profile-scoped handle
    _schedule_session_cap_enforcement()
    return _resume_response(ctx, sid, record, info=ctx.info(cwd, overrides), messages=[],
                            message_count=record["resume_message_count"], status="resuming", hydrating=True)


def _resume_cold(ctx: _Resume) -> dict:
    """Default cold resume: transcript now, agent OFF the response path (_make_agent can block for seconds;
    callers await this RPC before painting) — pre-warmed on a timer, _sess() builds on demand if the first
    prompt beats it. Unlike lazy, restores full ancestor history + persisted runtime identity."""
    sid, source, cwd = ctx.mint()
    try:
        history, display_history, raw_history = ctx.restore()
    except Exception as e:
        return _err(ctx.rid, 5000, f"resume failed: {e}")
    overrides = _stored_session_runtime_overrides(ctx.found)
    record = ctx.record(source, cwd, history, overrides, display_history_prefix=ctx.display_prefix(),
                        todo_state=_todo_state_from_history(history))
    if (reused := ctx.claim(sid, record)) is not None:
        return reused
    _schedule_agent_build(sid)
    _schedule_session_cap_enforcement()  # trim detached idle sessions over the cap
    return _resume_response(ctx, sid, record, info=ctx.info(cwd, overrides), display=display_history,
                            count_source=raw_history,
                            auto_continue=_maybe_schedule_auto_continue(sid, record, ctx.target))


def _resume_eager(ctx: _Resume) -> dict:
    """Synchronous build OUTSIDE _session_resume_lock (it would stall session.close), then double-checked."""
    if _stored_session_runtime_overrides(ctx.found).get("managed_model_params"):
        return _resume_cold(ctx)
    sid, source, _cwd = ctx.mint()
    with _profile_build_scope(ctx.profile_home):
        try:
            history, display_history, raw_history = ctx.restore()
            display_history_prefix = ctx.display_prefix()
            # Profile db so turns persist to the right state.db; stored runtime identity so switching chats does
            # not inherit another chat's global model.
            stored_runtime_overrides = _stored_session_runtime_overrides(ctx.found)
            conversation = _parse_model_config(ctx.found.get("model_config"), quiet=True).get("conversation_binding")
            resume_auth_user_id = _transport_auth_user_id(current_transport())
            if conversation:
                bound_record = ctx.record(source, ctx.profile_resume_cwd, history, stored_runtime_overrides)
                resume_auth_user_id = bound_record["auth_user_id"]
                stored_runtime_overrides["context_cwd"] = ctx.profile_resume_cwd
            agent = _make_agent_in_context(
                sid, ctx.target, session_db=ctx.db, platform_override=source,
                context_cwd_is_launch_artifact=(source in _LAUNCH_CWD_NOT_A_WORKSPACE and not ctx.profile_resume_cwd),
                auth_user_id=resume_auth_user_id, **stored_runtime_overrides)
        except Exception as e:
            return _err(ctx.rid, 5000, f"resume failed: {e}")
    with _session_resume_lock:
        live = _find_live_session_by_key(ctx.target, ctx.profile_home)
        if live is not None:
            with contextlib.suppress(Exception):
                agent.close()
            return _resume_reuse_live_locked(ctx, *live)
        try:
            with _profile_build_scope(ctx.profile_home):
                _init_session(sid, ctx.target, agent, history, cols=ctx.cols, cwd=ctx.profile_resume_cwd,
                              session_db=ctx.db, source=source, profile_home=ctx.profile_home,
                              explicit_cwd=bool(ctx.profile_resume_cwd))
                # Ownership TRANSFER: the agent holds the handle for life (AIAgent.close() releases it). The
                # owns_db drop is UNCONDITIONAL — the session is registered against the handle, so the finally
                # must not close it even if the transfer was refused (a leak beats "closed database" every
                # turn). Gated on owns_db: the SHARED launch handle must never move onto one session.
                if ctx.owns_db:
                    _transfer_db_to_agent(agent, ctx.db)
                ctx.owns_db = False
            if (session := _sessions.get(sid)) is not None:
                if stored_runtime_overrides.get("model_override") is not None:
                    session["model_override"] = stored_runtime_overrides["model_override"]
                # Each turn re-binds HERMES_HOME (mid-turn memory/skills reads); lease claimed lazily on turn 1.
                if ctx.profile_home is not None:
                    session["profile_home"] = str(ctx.profile_home)
                session.update(display_history_prefix=display_history_prefix, active_session_lease=None)
                from . import server
                from .session_conversation_binding import restore_conversation_session
                restore_conversation_session(server, session, ctx.found)
        except Exception as e:
            # _init_session registers _sessions[sid] BEFORE its first db read; left in place the fast path
            # would serve that dead session forever.
            if ctx.owns_db:
                with _sessions_lock:
                    _sessions.pop(sid, None)
            return _err(ctx.rid, 5000, f"resume failed: {e}")
        session = _sessions.get(sid) or {}
    return _resume_response(
        ctx, sid, session, info=_session_info(agent, session), display=display_history, count_source=raw_history,
        started_at=float(session.get("created_at") or time.time()),
        auto_continue=_maybe_schedule_auto_continue(sid, session, ctx.target) if session else None)


def _resume_session(rid, params: dict) -> dict:
    if not (target := params.get("session_id", "")):
        return _err(rid, 4006, "session_id required")
    ctx = _Resume(rid, params, target)
    # Profile scope: a DEDICATED handle we own until the agent takes it; else the shared launch db.
    ctx.db, ctx.owns_db = _profile_session_db(ctx.profile_home)
    try:
        if ctx.db is None:
            return _db_unavailable_error(rid, code=5000)
        if (resp := _resume_locate(ctx)) is not None:
            return resp
        _resume_follow_tip(ctx)
        if (resp := _resume_guard(ctx)) is not None:
            return resp
        ctx.profile_resume_cwd = _str_param(ctx.found, "cwd") or _profile_configured_cwd(ctx.profile_home)
        # Fast path: reuse a session live IN THIS PROFILE (never another profile's runtime).
        with _session_resume_lock:
            live = _find_live_session_by_key(ctx.target, ctx.profile_home)
        if live is not None:
            return _resume_reuse_live(ctx, *live)
        if ctx.lazy:
            return _resume_lazy(ctx)
        if ctx.eager_build:
            return _resume_eager(ctx)
        return _resume_deferred(ctx) if ctx.defer_history else _resume_cold(ctx)
    finally:
        # Refcounting alone does not release the sqlite fds: SessionDB pins ITSELF (atexit.register) once its
        # background token writer starts; only close() unregisters.
        if ctx.owns_db and ctx.db is not None:
            with contextlib.suppress(Exception):
                ctx.db.close()


def register(server) -> None:
    bind_module(globals(), server)
