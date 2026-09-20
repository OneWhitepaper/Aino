"""Session model resolution, persisted runtime overrides, and agent construction.

Like the gateway method siblings, these functions bind onto server globals so
session ownership, scoped configuration, and existing test seams stay canonical.
"""

from __future__ import annotations

from .method_ctx import bind_module

def _deferred_build_agent_kwargs(current: dict, session_db) -> dict:
    """_make_agent kwargs for a deferred (first-prompt) build. A lazy-resumed (watch) session carries the
    stored conversation id so the upgrade continues it; a cold deferred resume restores the full persisted
    runtime identity (like the eager resume's overrides splat) so the build can't drop the provider. No
    stored runtime, or an unroutable provider → this session's picked model/effort/tier, else the default.

    Managed models: stores model_source and model_id for platform models, defers binding until agent build."""
    kw = {"session_db": session_db, "context_cwd_is_launch_artifact": _context_cwd_is_launch_artifact(current),
          "platform_override": _session_source(current)}
    if resume_sid := current.get("resume_session_id"):
        kw["session_id"] = resume_sid

    # Managed model params from session.create or resume
    if managed := current.get("managed_model_params"):
        kw["managed_model_params"] = managed
        kw.update({k: v for k, v in (("reasoning_config_override", current.get("create_reasoning_override")),
                                    ("service_tier_override", current.get("create_service_tier_override")))
                   if v is not None})
        return kw
    resume_overrides = current.get("resume_runtime_overrides")
    if isinstance(resume_overrides, dict) and resume_overrides and _overrides_have_routable_provider(resume_overrides):
        kw.update(resume_overrides)
    else:
        if override := current.get("model_override"):
            kw["model_override"] = override
        kw.update({k: v for k, v in (("reasoning_config_override", current.get("create_reasoning_override")),
                                     ("service_tier_override", current.get("create_service_tier_override")))
                   if v is not None})
    return kw


def _resolve_session_platform() -> str:
    """``HERMES_DESKTOP=1`` without ``HERMES_DESKTOP_TERMINAL`` → "desktop" (chat panel; the agent then
    suggests TUI-only slash commands), else "tui" (embedded terminal pane or standalone ``hermes --tui``)."""
    desktop = is_truthy_value(os.environ.get("HERMES_DESKTOP"))
    return "desktop" if desktop and not is_truthy_value(os.environ.get("HERMES_DESKTOP_TERMINAL")) else "tui"


def _resolve_session_source(explicit: str | None) -> str:
    """Session DB ``source``: an explicit caller value (plugin session tagged ``"telegram"``) is never
    rewritten; only empty/None falls back to the env-resolved platform."""
    return explicit or _resolve_session_platform()


def _resolve_agent_platform(source: str | None) -> str:
    return _resolve_session_source(source)


def _config_model_target() -> tuple[str, str]:
    """(model, provider) selected by config.yaml — and ONLY config: the HERMES_MODEL launch seed fed into
    the per-turn sync would be replayed as a /model switch and persisted globally, or pin the session so
    dashboard/CLI model changes never reach an open chat. Empty model = "no preference" → no-op sync."""
    cfg_model = _load_cfg().get("model")
    if isinstance(cfg_model, dict):
        provider = str(cfg_model.get("provider") or "").strip()
        return str(cfg_model.get("default", "") or "").strip(), "" if provider.lower() == "auto" else provider
    return (cfg_model.strip() if isinstance(cfg_model, str) else ""), ""


def _resolve_startup_runtime() -> tuple[str, str | None]:
    model = _resolve_model()
    if explicit_provider := os.environ.get("HERMES_TUI_PROVIDER", "").strip():
        return model, explicit_provider
    if not (explicit_model := _env_model_seed()):
        return model, None
    with contextlib.suppress(Exception):
        from hermes_cli.models import detect_static_provider_for_model
        cfg = _load_cfg().get("model") or {}
        current_provider = ((str(cfg.get("provider") or "").strip().lower() if isinstance(cfg, dict) else "")
                            or os.environ.get("HERMES_INFERENCE_PROVIDER", "").strip().lower() or "auto")
        if detected := detect_static_provider_for_model(explicit_model, current_provider):
            provider, detected_model = detected
            return detected_model, provider
    return model, None


def _is_routable_provider(provider: str) -> bool:
    with contextlib.suppress(Exception):
        from hermes_cli.runtime_provider import is_routable_provider
        return is_routable_provider(provider)
    return False


def _overrides_have_routable_provider(overrides: dict) -> bool:
    """Whether persisted runtime overrides still name a routable provider (renamed/removed → "Unknown
    provider" at agent init). Empty = NOT routable, so the caller falls back to the session's picked model."""
    provider = str(overrides.get("provider_override") or "").strip()
    if not provider:
        provider = str((overrides.get("model_override") or {}).get("provider") or "").strip()
    return bool(provider) and _is_routable_provider(provider)


def _parse_model_config(raw, *, quiet: bool = False) -> dict:
    """A row's ``model_config`` (dict or JSON text) as a dict; ``{}`` when absent/invalid."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            if not quiet:
                raise
            logger.debug("failed to parse stored session model_config", exc_info=True)
    return {}


def _stored_session_runtime_overrides(row: dict | None) -> dict:
    """Runtime fields persisted with a stored session (model column, ``billing_provider``, JSON ``model_config``):
    resume restores the model/provider/reasoning THAT chat used, not the global pick. Plugin-owned Bot-Mode
    sessions are exempt and rebuild from the member profile's CURRENT config (a stale provider pin left
    room bots "out of Nous credits" after a profile switch); signals: ``room_plumbing`` /
    ``follow_profile_config`` markers, the legacy hidden + "Group:" title, the title exactly "Bot Chat"."""
    if not row:
        return {}
    model_config = _parse_model_config(row.get("model_config"), quiet=True)
    from .managed_session import managed_metadata
    if managed := managed_metadata(model_config):
        return {"managed_model_params": managed}
    _row_title = str(row.get("title") or "").strip()
    if (model_config.get("room_plumbing") or (row.get("hidden") and _row_title.startswith("Group:"))
            or model_config.get("follow_profile_config") or _row_title == "Bot Chat"):
        return {}
    overrides: dict = {}
    field = lambda k: str(model_config.get(k) or "").strip()
    model = str(row.get("model") or model_config.get("model") or "").strip()
    # ``billing_provider`` is only the billing bucket — for a custom endpoint the bare class "custom", which
    # agent_init treats as non-routable. Only restore an explicit provider; else resume uses the configured default.
    provider = field("provider")
    billing_provider = str(model_config.get("billing_provider") or row.get("billing_provider") or "").strip()
    if not provider and billing_provider.lower() not in _BARE_BILLING_PROVIDERS:
        provider = billing_provider
    base_url, api_mode, service_tier = field("base_url"), field("api_mode"), field("service_tier")
    reasoning_config = model_config.get("reasoning_config")
    # Heal a stale provider persisted by an older build (renamed/removed custom provider → "Unknown provider"):
    # recover ``custom:<name>`` from the stored base_url, then from the entry serving the model; else drop it.
    if provider and not _is_routable_provider(provider):
        healed = None
        try:
            from hermes_cli.runtime_provider import canonical_custom_identity
            healed = canonical_custom_identity(base_url=base_url or None, model=model or None)
        except Exception:
            logger.debug("custom provider identity recovery failed", exc_info=True)
        if healed:
            logger.info("healed stale session provider %r to %r", provider, healed)
            provider = healed
            base_url = ""  # the healed identity owns a registered endpoint; the snapshot URL must not override it
        else:
            provider = ""
    if model:
        # Same dict-shaped override live /model switches use, so a DB-restored session keeps custom endpoint
        # metadata across resume and rebuilds (/new). Raw api_key is never persisted/restored.
        overrides["model_override"] = {
            "model": model, "provider": provider or None, "base_url": base_url or None, "api_mode": api_mode or None}
    if provider:
        overrides["provider_override"] = provider
    if isinstance(reasoning_config, dict):
        overrides["reasoning_config_override"] = reasoning_config
    if service_tier:  # None = "inherit the profile" at _make_agent; "" = real override "no priority tier"
        overrides["service_tier_override"] = "" if service_tier.lower() == "normal" else service_tier
    return overrides


def _runtime_model_config(agent, existing: dict | None = None) -> dict:
    """Merge the agent's CURRENT runtime identity onto the row's persisted ``model_config``. Falsy agent
    attributes DELETE the key rather than skip the write: resume reads provider/endpoint from this JSON
    (model column written separately), so a stale provider would route the resumed chat to the wrong endpoint."""
    config = dict(existing or {})
    from .managed_session import managed_metadata
    if managed := managed_metadata(getattr(agent, "_managed_model_metadata", None)):
        return {**{k: v for k, v in config.items() if k in (
            "_branched_from", "_delegate_from", "room_plumbing", "follow_profile_config",
            "max_iterations", "reasoning_config", "max_tokens", "yolo_mode", "service_tier")},
            **managed, "provider": "aino"}
    for key in ("model_source", "platform_owner", "model_id"):
        config.pop(key, None)
    attr = lambda k: str(getattr(agent, k, "") or "").strip()
    model, provider, base_url = attr("model"), attr("provider"), attr("base_url")
    if provider.lower() == "custom":
        # ``agent.provider`` resolves every named custom entry to the literal "custom", losing the entry
        # identity (api_key is never persisted): recover ``custom:<name>`` from the endpoint URL.
        try:
            from hermes_cli.runtime_provider import canonical_custom_identity
            provider = canonical_custom_identity(base_url=base_url, model=model or None) or provider
        except Exception:
            logger.debug("custom provider identity lookup failed", exc_info=True)
    reasoning_config = getattr(agent, "reasoning_config", None)
    live = {
        "model": model, "provider": provider, "base_url": base_url, "api_mode": attr("api_mode"),
        # An empty dict is still a real (present) reasoning config.
        "reasoning_config": reasoning_config if isinstance(reasoning_config, dict) else None,
        "service_tier": getattr(agent, "service_tier", None),
    }
    for key, value in live.items():
        if value or isinstance(value, dict):
            config[key] = value
        else:
            config.pop(key, None)
    return config


def _sync_agent_session_model_config(agent) -> None:
    """Keep compression/child persistence on the gateway's canonical runtime projection."""
    agent._session_init_model_config = _runtime_model_config(
        agent, getattr(agent, "_session_init_model_config", None))


def _persist_live_session_runtime(session: dict | None) -> None:
    """Persist the active runtime for resume and future compression children."""
    agent = (session or {}).get("agent")
    if agent is not None:
        _sync_agent_session_model_config(agent)
    live = _live_session_agent_db(session)
    if live is None:
        return
    agent, session_key, db = live
    try:
        row = db.get_session(session_key) or {}
        model_config = _runtime_model_config(agent, _parse_model_config(row.get("model_config")))
        if (tier_override := session.get("create_service_tier_override")) is not None:
            # agent.service_tier is None for explicit normal; without this the distinction is erased on every persist.
            model_config["service_tier"] = tier_override or "normal"
        model = str(getattr(agent, "model", "") or "").strip()
        if hasattr(db, "update_session_meta"):
            db.update_session_meta(session_key, json.dumps(model_config), model or None)
        elif model and hasattr(db, "update_session_model"):
            db.update_session_model(session_key, model)
    except Exception:
        logger.debug("failed to persist live session runtime", exc_info=True)


def _live_session_agent_db(session: dict | None):
    """(agent, session_key, db) for a live record, or None when any of them is missing."""
    agent = (session or {}).get("agent")
    session_key = str((session or {}).get("session_key") or "").strip()
    if agent is None or not session_key:
        return None
    db = getattr(agent, "_session_db", None) or _get_db()
    return None if db is None else (agent, session_key, db)


def _persist_live_session_system_prompt(session: dict | None) -> None:
    """Refresh the stored system prompt after a live runtime identity change."""
    live = _live_session_agent_db(session)
    if live is None or not hasattr(live[0], "_build_system_prompt") or not hasattr(live[2], "update_system_prompt"):
        return
    agent, session_key, db = live
    # Re-bind the session's profile HERMES_HOME (the build's finally reset it → root profile's SOUL.md/skills)
    # and session context (on the RPC thread _SESSION_CWD is unset → the process TERMINAL_CWD would persist).
    # Without this, _start_agent_build's finally block has already reset the override and the rebuilt prompt
    # silently uses the root profile's SOUL.md and skills. See issue #50233.
    profile_home = session.get("profile_home")
    home_token = set_hermes_home_override(profile_home) if profile_home else None
    session_tokens = _set_session_context(session_key, cwd=_session_cwd(session))
    try:
        prompt = agent._cached_system_prompt = agent._build_system_prompt(None)
        db.update_system_prompt(getattr(agent, "session_id", None) or session_key, prompt)
    except Exception:
        logger.warning("failed to persist live session system prompt for session %s", session_key, exc_info=True)
    finally:
        _clear_session_context(session_tokens)
        if home_token is not None:
            reset_hermes_home_override(home_token)


def _resolve_agent_model_runtime(model_override, provider_override) -> tuple[str, dict]:
    """(model, runtime) for a new agent; a per-session override (/model switch or a resumed row's persisted
    runtime) wins over global config/env. Older rows stored the resolved provider "custom" (no named entry
    matches) — recover the identity from the persisted base_url or the rebuild fails "No LLM provider
    configured". Persisted base_url/api_key/api_mode are honored only for the original runtime, never a fallback.

    Platform leases are resolved separately, never by this ambient auth/fallback chain."""

    if isinstance(model_override, dict) and model_override.get("model"):
        model = str(model_override.get("model") or "")
        requested_provider = model_override.get("provider") or provider_override or None
        override_base_url = model_override.get("base_url")
        resolve_kwargs = {}
        if str(requested_provider or "").strip().lower() == "custom":
            from hermes_cli.runtime_provider import canonical_custom_identity
            if recovered := canonical_custom_identity(base_url=override_base_url or None, model=model or None):
                requested_provider = recovered
            if override_base_url:
                # Failing identity recovery, still hand base_url to the direct-alias branch so pool/env credentials resolve.
                resolve_kwargs["explicit_base_url"] = override_base_url
        resolve_kwargs.update(requested=requested_provider, target_model=model or None)
        overrides = {k: model_override.get(k) for k in ("base_url", "api_key", "api_mode")}
    else:
        model, requested_provider = _resolve_startup_runtime()
        if isinstance(model_override, str) and model_override:
            model = model_override
        if provider_override:
            requested_provider = provider_override
        resolve_kwargs = {"requested": requested_provider, "target_model": model or None}
        overrides = {}
    resolution = _resolve_runtime_with_fallback(resolve_kwargs)
    if resolution.used_fallback:
        if not resolution.selected_model:
            raise RuntimeError("Auth fallback resolved without a model")
        return resolution.selected_model, resolution.runtime
    resolution.runtime.update({k: v for k, v in overrides.items() if v})
    return model, resolution.runtime


def _startup_system_prompt(cfg: dict, task_id: str) -> str:
    """Config ephemeral system prompt + HERMES_TUI_SKILLS preload block. Hard-fails only when EVERY requested
    skill is missing (cli.py parity): a typo'd name must not auto-block the Kanban task."""
    from hermes_cli.config import resolve_ephemeral_system_prompt_from_config
    system_prompt = resolve_ephemeral_system_prompt_from_config(cfg)
    startup_skills = _parse_tui_skills_env()
    if not startup_skills:
        return system_prompt
    from agent.skill_commands import build_preloaded_skills_prompt
    skills_prompt, loaded_skills, missing_skills = build_preloaded_skills_prompt(startup_skills, task_id=task_id)
    if missing_skills:
        missing_display = ", ".join(missing_skills)
        if not loaded_skills:
            raise ValueError(f"Unknown skill(s): {missing_display}")
        logger.warning("Unknown skill(s) requested, skipping: %s. Continuing with: %s. "
                       "List available skills with `hermes skills list`.", missing_display, ", ".join(loaded_skills))
    if skills_prompt:
        system_prompt = "\n\n".join(part for part in (system_prompt, skills_prompt) if part).strip()
    return system_prompt


def _make_agent(
    sid: str, key: str, session_id: str | None = None, session_db=None,
    model_override: dict | str | None = None, provider_override: str | None = None,
    reasoning_config_override: dict | None = None, service_tier_override: str | None = None,
    platform_override: str | None = None, context_cwd_is_launch_artifact: bool | None = None,
    managed_model_params: dict | None = None, auth_user_id: str | None = None):
    # AC-4 test seam: dead unless armed by the isolated certify harness.
    from tui_gateway.synthetic_turn import maybe_build_synthetic_agent
    synthetic = maybe_build_synthetic_agent(session_id or key, model_override)
    if synthetic is not None:
        return synthetic
    from run_agent import AIAgent
    # MCP discovery runs in a daemon thread (a dead server can't freeze the shell); the agent snapshots its tool
    # list once, so briefly wait for in-flight discovery. Dashboard /api/ws uses mcp_startup; TUI stdio uses entry.
    for _mod in ("hermes_cli.mcp_startup", "tui_gateway.entry"):
        with contextlib.suppress(Exception):
            importlib.import_module(_mod).wait_for_mcp_discovery()
    cfg = _load_cfg()
    # Load hooks alongside the same profile config used to construct this agent.
    from agent.shell_hooks import register_from_config
    register_from_config(cfg)
    system_prompt = _startup_system_prompt(cfg, session_id or key)
    from .managed_session import managed_metadata, runtime_for_session
    model, runtime = (runtime_for_session(sid) if managed_model_params
                      else _resolve_agent_model_runtime(model_override, provider_override))
    _pr = _load_provider_routing()
    platform = _resolve_agent_platform(platform_override)
    ignore_rules = is_truthy_value(os.environ.get("HERMES_IGNORE_RULES"))
    with _sessions_lock:
        session = _sessions.get(sid)
    agent = AIAgent(
        model=model, max_iterations=_cfg_max_turns(cfg, 500), provider=runtime.get("provider"),
        base_url=runtime.get("base_url"), api_key=runtime.get("api_key"), api_mode=runtime.get("api_mode"),
        acp_command=runtime.get("command"), acp_args=runtime.get("args"),
        credential_pool=runtime.get("credential_pool"), quiet_mode=True,
        verbose_logging=False,  # DEBUG agent logging; independent of tool_progress_mode
        reasoning_config=(
            reasoning_config_override if reasoning_config_override is not None else _load_reasoning_config(str(model or ""))),
        service_tier=service_tier_override if service_tier_override is not None else _load_service_tier(),
        enabled_toolsets=_load_enabled_toolsets(platform),
        # OpenRouter provider_routing prefs (gateway + CLI parity).
        providers_allowed=_pr.get("only"), providers_ignored=_pr.get("ignore"), providers_order=_pr.get("order"),
        provider_sort=_pr.get("sort"), provider_require_parameters=_pr.get("require_parameters", False),
        provider_data_collection=_pr.get("data_collection"), platform=platform, session_id=session_id or key,
        # The dashboard login identity reaches memory providers as the runtime user, like a gateway user id.
        # Builds that run before the record exists (branch, eager resume, compute host) pass it explicitly.
        user_id=auth_user_id if auth_user_id is not None else _session_auth_user_id(session),
        session_db=session_db if session_db is not None else _get_db(), ephemeral_system_prompt=system_prompt or None,
        checkpoints_enabled=is_truthy_value(os.environ.get("HERMES_TUI_CHECKPOINTS")),
        pass_session_id=is_truthy_value(os.environ.get("HERMES_TUI_PASS_SESSION_ID")),
        skip_context_files=ignore_rules, skip_memory=ignore_rules,
        fallback_model=[] if managed_model_params else _load_fallback_model(),
        **_agent_cbs(sid))
    if managed_model_params:
        agent._managed_model_metadata = managed_metadata(managed_model_params)
        _sync_agent_session_model_config(agent)
    if context_cwd_is_launch_artifact is None:
        context_cwd_is_launch_artifact = _context_cwd_is_launch_artifact(session)
    agent._context_cwd_is_launch_artifact = bool(context_cwd_is_launch_artifact)
    return agent


def register(server) -> None:
    bind_module(globals(), server)
