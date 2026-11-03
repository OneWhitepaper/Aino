"""Main's TUI text for the session reads its sidecar answered itself: /status, /context.

On main the TUI's ``slash.exec`` never reached the messaging gateway's handlers: ``/status`` was
``session.status`` (``Hermes TUI Status``), ``/context`` was ``_format_live_context_output`` (the
conversation counts, then the desktop gauge's category table). A TUI session on the shared owner
gets the same lines here, read from the owner's live agent and stored row; every other surface keeps
the gateway's own handlers (``gateway/session_commands.py``). ``/cron``, the classic CLI's handler
that main's TUI ran in its slash worker, is gateway/session_cron_commands.py.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
from collections import Counter
from pathlib import Path

# The TUI surfaces whose /status and /context read as main's TUI sidecar did.
_TUI_SOURCES = frozenset({'tui'})


def tui_read(policy, name: str, arg: str):
    """The renderer for a TUI session's read of *name*, or None to keep the gateway handler."""
    if policy is None or policy.source not in _TUI_SOURCES:
        return None
    if name == 'status':
        return _status
    if name == 'context':
        return _context
    return None


def _stored_id(authority, ref) -> str:
    with contextlib.suppress(Exception):
        from hermes_state_local import local_receipt
        return local_receipt(authority.db, ref.session_id)['entry']['session_id'] or ref.session_id
    return ref.session_id


def _context_id(authority, ref) -> str:
    """The compression tip the session's model context lives in; the runtime id may still name a parent."""
    stored = _stored_id(authority, ref)
    return authority.db.get_compression_tip(stored) or stored


def _model_history(db, tip) -> list:
    """The tip's working context: its active rows as live replay loads them, minus the ``session_meta``
    bookkeeping the gateway strips before the model sees history. Superseded segments are not read."""
    return [m for m in db.get_messages_as_conversation(tip, repair_alternation=True, include_row_ids=True)
            if m['role'] != 'session_meta']


def _status(authority, ref, live, policy, agent, arg) -> str:
    """``tui_gateway/methods_session.py`` ``session.status`` on main, for the owner's session."""
    from hermes_cli.status_report import build_status_fields, status_lines
    from tui_gateway import server
    stored = _stored_id(authority, ref)
    row = {}
    with contextlib.suppress(Exception):
        row = authority.db.get_session(stored) or {}
    running = authority._handle(ref).execution_state != 'idle'
    fields = build_status_fields(
        stored, agent, row, model=policy.current_model(authority) if agent is None else None,
        provider=policy.provider if agent is None else None,
        tokens=getattr(agent, 'session_total_tokens', 0) if agent is not None else None,
        agent_running=running, home=authority.profile_id)
    if fields['provider'] == 'custom':  # the adapter's billing class: show the entry the session runs on
        from gateway.run import _profile_runtime_scope
        from hermes_cli.runtime_provider_custom import session_provider_identity
        with _profile_runtime_scope(Path(authority.profile_id)):
            fields['provider'] = session_provider_identity('custom', getattr(agent, 'requested_provider', None),
                getattr(agent, 'base_url', None) or policy.base_url, fields['model'])
    project = server._project_info_for_cwd(policy.cwd)
    return '\n'.join([
        'Hermes TUI Status', '', *status_lines(fields, 'session_id', 'path'),
        *([f"Project: {project['name']}"] if project else []),
        *status_lines(fields, 'title', 'model', 'created', 'last_activity', 'tokens', 'agent_running')])


def _context(authority, ref, live, policy, agent, arg) -> str:
    """Main's ``_format_live_context_output``: counts by role, model/provider, then the category
    table off the live agent (``render_context_breakdown_lines(grid=False)``), else the stored usage."""
    stored = _context_id(authority, ref)
    rows = []
    with contextlib.suppress(Exception):
        rows = authority.db.get_messages_as_conversation(stored, include_ancestors=True, include_row_ids=True)
    from gateway.session_controls import display_projection
    messages = display_projection(rows, authority.profile_id) if rows else []
    breakdown: list[str] = []
    if agent is not None:
        with contextlib.suppress(Exception):
            from agent.context_breakdown import (
                compute_context_details, compute_session_context_breakdown, render_context_breakdown_lines)
            payload = compute_session_context_breakdown(agent, _model_history(authority.db, stored))
            details = None
            if arg.strip().lower() in {'all', 'full', 'details'}:
                with contextlib.suppress(Exception):
                    details = compute_context_details(agent)
            breakdown = render_context_breakdown_lines(payload, details=details, grid=False)
    lines = [f'Conversation: {len(messages)} messages' if messages else 'Conversation is empty (no messages yet).']
    roles = Counter(str(msg.get('role') or 'unknown') for msg in messages)
    lines.append('  ' + ', '.join(f'{r}: {roles.get(r, 0)}' for r in ('user', 'assistant', 'tool', 'system')))
    if model := (getattr(agent, 'model', '') if agent is not None else '') or policy.current_model(authority):
        lines.append(f'Model: {model}')
    # Main read the provider off the compute-host metadata mirror, which a local session never
    # filled, so its TUI always printed ``auto`` here; kept as main's text.
    lines.append('Provider: auto')
    if breakdown:
        return '\n'.join([*lines, '', *breakdown])
    compressor = getattr(agent, 'context_compressor', None) if agent is not None else None
    used, maximum = (int(getattr(compressor, name, 0) or 0) for name in ('last_prompt_tokens', 'context_length'))
    if used and maximum:
        lines.append(f'Context usage: {used:,} / {maximum:,} tokens ({used / maximum * 100:.1f}%)')
    elif used:
        lines.append(f'Context usage: {used:,} tokens')
    if count := int(getattr(compressor, 'compression_count', 0) or 0):
        lines.append(f'Compressions: {count:,}')
    return '\n'.join(lines)


async def run_tui_read(authority, ref, live, policy, render, arg) -> dict:
    """Render off the owner loop, inside the owning profile and the session's workspace."""
    from gateway.session_authorities import owner_scope
    from gateway.session_commands import _session_workspace
    agent = authority.agent(ref)

    def build():
        with owner_scope(authority), _session_workspace(authority.runner, live.source):
            return render(authority, ref, live, policy, agent, arg)
    return {'type': 'exec', 'output': await asyncio.to_thread(build)}


async def context_breakdown(connection, ref, params) -> dict:
    """``session.context_breakdown`` on the owner: the category estimate (``compute_session_context_
    breakdown``) and context-file manifest over the compression tip's model history,
    built in the session's workspace. Before the agent exists, the persisted transcript
    and system prompt still provide immediate category estimates; live-only categories are added
    once the agent is resident."""
    from gateway.session_busy_controls import authorize
    from hermes_state_runtime import RuntimeStoreError
    if set(params) - {'session_id', 'profile'} or not isinstance(ref.session_id, str) or not ref.session_id:
        raise RuntimeStoreError('invalid_params')
    authorize(connection, ref, params, 'session:read')
    authority = connection.authority
    live = authority.sessions.get(ref.session_id)
    if live is None:
        raise RuntimeStoreError('not_found')
    task = live.context_breakdown_task
    if task is None or task.done():
        task = live.context_breakdown_task = asyncio.create_task(_read_context_breakdown(connection, ref, live))
        task.add_done_callback(lambda done: _context_breakdown_finished(live, done))
    return dict(await asyncio.shield(task))


def _context_breakdown_finished(live, task) -> None:
    if live.context_breakdown_task is task:
        live.context_breakdown_task = None
    if not task.cancelled():
        task.exception()  # A viewer may have left before a failed read settled.


async def _read_context_breakdown(connection, ref, live) -> dict:
    from hermes_state_runtime import RuntimeStoreError
    authority = connection.authority
    # A transcript/model edit can race the first snapshot. Re-read once rather than publish it
    # under newer intent; a continuously changing turn should retry after it settles.
    for _ in range(2):
        agent = authority.agent(ref)
        if agent is None:
            payload = await asyncio.to_thread(_cold_context_breakdown, authority, ref, live)
        else:
            payload = await asyncio.to_thread(_live_context_breakdown, authority, ref, live, agent)
        if payload is not None:
            return payload
    raise RuntimeStoreError('session_busy')


def _live_context_breakdown(authority, ref, live, agent) -> dict | None:
    from gateway.session_authorities import owner_scope
    from gateway.session_commands import _session_workspace
    stored = _context_id(authority, ref)
    from agent.context_breakdown import compute_session_context_breakdown
    from agent.context_file_sources import context_file_sources_for_agent
    with owner_scope(authority), _session_workspace(authority.runner, live.source):
        # Reuse the payload while neither the transcript nor the agent moved.
        key = (_agent_context_marks(agent), authority.db.conversation_revision(stored))
        cached = live.context_breakdown
        if cached is not None and cached[0] == (id(agent), key):
            return dict(cached[1])
        conversation = _model_history(authority.db, stored)
        payload = compute_session_context_breakdown(agent, conversation)
        payload['context_files'] = context_file_sources_for_agent(agent)
        if (authority.agent(ref) is not agent or _context_id(authority, ref) != stored
                or key != (_agent_context_marks(agent), authority.db.conversation_revision(stored))):
            return None
        live.context_breakdown = ((id(agent), key), payload)
        return dict(payload)


def _cold_context_breakdown(authority, ref, live) -> dict | None:
    """Use the frozen prompt/tools and provider anchor without constructing an agent."""
    from agent.usage_anchor import USAGE_ANCHOR_MODEL_CONFIG_KEY, context_usage_from_history
    from agent.context_breakdown import compute_cold_context_categories
    from gateway.session_authorities import owner_scope
    with owner_scope(authority):
        stored = _context_id(authority, ref)
        anchor = authority.db.get_session_model_config_value(stored, USAGE_ANCHOR_MODEL_CONFIG_KEY, None)
        row = authority.db.get_session(stored) or {}
        key = ('cold', stored, authority.db.conversation_revision(stored), repr(anchor),
               row.get('model'), row.get('system_prompt_hash'), row.get('system_prompt'),
               row.get('tool_names'))
        cached = live.context_breakdown
        if cached is not None and cached[0] == key:
            return dict(cached[1])
        history = _model_history(authority.db, stored)
        usage = context_usage_from_history(
            history, anchor, row.get('_system_prompt_resolved') or row.get('system_prompt'))
        payload = _stored_breakdown(row, history, usage)
        if not row.get('system_prompt'):
            # Before a prompt exists, the transcript still gives immediate, honest category estimates.
            payload.update(compute_cold_context_categories(history, row.get('_system_prompt_resolved')))
        if (authority.agent(ref) is not None or _context_id(authority, ref) != stored
                or key[2] != authority.db.conversation_revision(stored)
                or anchor != authority.db.get_session_model_config_value(stored, USAGE_ANCHOR_MODEL_CONFIG_KEY, None)
                or (authority.db.get_session(stored) or {}) != row):
            return None
        live.context_breakdown = (key, payload)
        return dict(payload)


def _stored_breakdown(row, conversation, usage) -> dict:
    """``stored_context_breakdown`` over the session row's frozen system prompt and tools[] pin, beside its
    stored usage. Tools are measured as the next agent restores them (``pinned_tool_defs``)."""
    from agent.context_breakdown import stored_context_breakdown
    from tools.mcp_tool_agent import pinned_tool_defs
    breakdown = {'categories': [], 'estimated_total': 0}
    # No prompt until an agent first built one: nothing to measure yet, the contract's pre-build shape.
    if prompt := row.get('system_prompt'):
        try:
            pin = json.loads(row.get('tool_names') or 'null')
        except (TypeError, ValueError):
            pin = None  # a pin hash whose row was swept resolves to itself
        breakdown = stored_context_breakdown(prompt, pinned_tool_defs(pin), conversation)
    return {**breakdown, 'context_max': int(usage.get('context_max') or 0),
            'context_percent': int(usage.get('context_percent') or 0), 'context_used': int(usage.get('context_used') or 0),
            'context_estimated': bool(usage.get('context_estimated', False)),
            'context_source': str(usage.get('context_source') or 'unknown'), 'model': str(usage.get('model') or row.get('model') or '')}


def _agent_context_marks(agent) -> tuple:
    """What the breakdown reads off the agent besides the transcript: model, toolset size, window,
    measured prompt tokens, compressions and the usage anchors."""
    comp = getattr(agent, 'context_compressor', None)
    return (getattr(agent, 'model', None), getattr(agent, 'provider', None), len(getattr(agent, 'tools', None) or ()),
            *(getattr(comp, name, None) for name in ('context_length', 'last_prompt_tokens', 'compression_count')),
            repr(getattr(agent, '_turn_base_usage_anchor', None)), repr(getattr(agent, '_usage_anchor', None)))
