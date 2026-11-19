"""What a session picker shows for each ``session.list`` row (``picker: true``), and the folder filter (#150091).

Location (``cwd``, ``workspace``) comes from the conversation's first row: the row ``workspace`` filters
by (``list_sessions_rich`` filters root rows, as ``hermes -c`` does), and the row a workspace move
rewrites with every other one. The rest comes from its current segment (a local receipt's entry, else
the compression tip), as ``list_sessions_rich`` projects a compressed chain onto its tip: the first
prompt there (``preview``), its branch, pin, newest activity and newest reply. The stored feed passes the
columns ``list_sessions_rich`` already read; the live feed reads them here. Either way a page is one
store checkout in a worker thread: batched lookups and one indexed probe per segment for its last reply.
"""
from __future__ import annotations

import json

from hermes_state_local import POLICY_PREFIX, local_lineage_owner
from hermes_state_runtime import RuntimeStoreError


def fill_execution_modes(db, rows, *, id_key='session_id'):
    """Project the immutable policy without restoring sessions or duplicating their stored identity."""
    if not rows:
        return
    with db._read_ctx() as conn:
        owners = {row[id_key]: local_lineage_owner(conn, row[id_key]) for row in rows}
        keys = list({POLICY_PREFIX + owner for owner in owners.values()})
        saved = conn.execute('SELECT key,value FROM state_meta WHERE key IN (' + ','.join('?' for _ in keys) + ')',
                             keys).fetchall()
    modes = {}
    for key, value in saved:
        try:
            mode = json.loads(value)['policy'].get('execution_mode', 'work')
            if mode not in ('work', 'code'):
                raise ValueError('invalid execution mode')
            modes[key[len(POLICY_PREFIX):]] = mode
        except (ValueError, TypeError, KeyError) as exc:
            raise RuntimeStoreError('storage_unavailable') from exc
    for row in rows:
        row['execution_mode'] = modes.get(owners[row[id_key]], 'work')


def workspace_members(db, session_ids, workspace):
    """The ids among *session_ids* whose row is in *workspace* (``SessionDB.sessions_in_workspace``: the
    clause ``list_sessions_rich`` filters the stored feed by, ``hermes -c``'s rule)."""
    return db.sessions_in_workspace(session_ids, workspace)


def _last_reply(candidates):
    """The newest of a segment's replies (``picker_session_facts``) that shows text, projected as a display
    read projects it (``project_compaction_message_for_display``): a pure handoff the compressor wrote as an
    assistant row shows nothing, so the reply before it stands; a carrier shows the reply it wraps."""
    from agent.compaction_display import project_compaction_message_for_display
    from agent.message_content import flatten_message_text
    from hermes_state_common import _shape_preview
    for content, summary in candidates:
        shown = project_compaction_message_for_display(
            {'role': 'assistant', 'content': content, '_compressed_summary': summary})
        text = _shape_preview(flatten_message_text(shown['content'])) if shown is not None else ''
        if text:
            return text
    return None


def fill_picker_fields(db, items):
    """Set the picker fields on each ``(row, root, segment, listed)``: *listed* is the segment's
    ``list_sessions_rich`` row (its ``preview`` / ``last_active`` / branch / pin), None to read them."""
    from hermes_state_common import _shape_preview
    from hermes_state_sessions import workspace_key
    roots, segments, replies = db.picker_session_facts(
        [root for _, root, _, _ in items], [segment for _, _, segment, listed in items if listed is None],
        [segment for _, _, segment, _ in items])
    replies = {segment: _last_reply(candidates) for segment, candidates in replies.items()}
    for row, root, segment, listed in items:
        if listed is None:
            listed = segments.get(segment)
            if listed is None:
                continue  # deleted since it was listed: the row keeps what the feed read
            listed = {**listed, 'preview': _shape_preview(listed['_preview_raw'])}
        first = roots.get(root) or {}
        row.update(preview=listed.get('preview') or None, cwd=first.get('cwd') or None,
                   workspace=workspace_key(first), git_branch=listed.get('git_branch') or None,
                   last_active_at=listed.get('_effective_last_active') or listed.get('last_active'),
                   pinned=bool(listed.get('pinned')), last_reply=replies[segment])


def current_segments(authority, session_ids):
    """``{logical id: current physical segment}`` (``SessionDB.session_current_segments``: a local receipt's
    entry, else the compression tip) in one store checkout."""
    return authority.db.session_current_segments(session_ids)


def live_picker_page(authority, sessions, limit, workspace=None, picker=False):
    """The live feed's page: *sessions* (newest first) in *workspace*, cut to *limit*, with the picker
    fields when asked."""
    if workspace is not None:
        members = workspace_members(authority.db, [row['session_id'] for row in sessions], workspace)
        sessions = [row for row in sessions if row['session_id'] in members]
    page = sessions[:limit]
    fill_execution_modes(authority.db, page)
    if picker and page:
        segments = current_segments(authority, [row['session_id'] for row in page])
        fill_picker_fields(authority.db, [(row, row['session_id'], segments.get(row['session_id'], row['session_id']),
                                           None) for row in page])
    return page
