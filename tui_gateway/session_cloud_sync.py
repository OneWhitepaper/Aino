"""Refresh remote history only at an idle resume or before a new local turn."""
from __future__ import annotations

from hermes_state_cloud_sync import GENERATION, get_meta


def refresh_cloud_history(session, db, target, canonicalize, *, before_turn=False, exclude_submitted=False):
    """A durable import generation invalidates row-id append heuristics.

    No runtime tool, model or system-prompt state is restored from the document.
    The existing agent receives the new transcript at its next submitted turn.
    """
    if db is None or not target or (session.get('running') and not before_turn):
        return False
    with db._read_ctx() as conn:
        generation = get_meta(conn, GENERATION + target)
    if generation is None or session.get('_cloud_sync_generation') == (target, generation):
        return False
    # Resolve a compression successor before the next submit chooses its persistence target.
    tip = db.get_compression_tip(target) or target
    db.assert_resume_safe(tip)
    raw, display = db.get_resume_conversations(tip)
    ceiling = (session.get('_submit_user_row') or {}).get('_row_id') if exclude_submitted else None
    if isinstance(ceiling, int):
        raw = [m for m in raw if m.get('_row_id', 0) < ceiling]
    history = canonicalize(raw)
    with session['history_lock']:
        if session.get('running') and not before_turn:
            return False
        session['history'] = history
        session['history_version'] = int(session.get('history_version', 0)) + 1
        session['session_key'] = tip
        session['display_history_prefix'] = db.get_ancestor_display_prefix(tip)
        session['resume_message_count'] = len(display)
        session['_cloud_sync_generation'] = (tip, generation)
        if (agent := session.get('agent')) is not None:
            agent.session_id = tip
    return True
