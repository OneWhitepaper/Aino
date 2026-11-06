"""Guarded history replacement and durable sync receipts on SessionDB's writer."""
from __future__ import annotations

import json

from hermes_cli.cloud_sync_portable import SESSION_FIELDS, digest, dumps, payload, remap_conflict
from hermes_state_mutation_guards import delete_targets, require_idle

PREFIX = 'cloud_sync.record.v1.'
GENERATION = 'cloud_sync.generation.v1.'


def replacement_import_sql(sql, params):
    """Keep local execution/routing columns while replacing validated portable columns."""
    return sql + ' ON CONFLICT(id) DO UPDATE SET ' + ', '.join(
        f'{key}=excluded.{key}' for key in params if key != 'id' and key in (*SESSION_FIELDS, 'model_config'))


def get_meta(conn, key, default=None):
    row = conn.execute('SELECT value FROM state_meta WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else default


def put_meta(conn, key, value):
    conn.execute('INSERT INTO state_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                 (key, dumps(value)))


def lineage_groups(conn):
    """Use actual compression edges, retaining forks as independent conversations."""
    rows = {r['id']: dict(r) for r in conn.execute('SELECT id,parent_session_id,end_reason,model_config FROM sessions')}
    groups = {}
    for sid in rows:
        root, seen = sid, set()
        while root not in seen:
            seen.add(root)
            row = rows[root]
            parent = rows.get(row['parent_session_id'])
            config = json.loads(row['model_config'] or '{}')
            fork = any(config.get(k) == row['parent_session_id'] for k in ('_branched_from', '_delegate_from', '_reset_from'))
            if parent is None or parent['end_reason'] != 'compression' or fork:
                break
            root = parent['id']
        groups.setdefault(root, []).append(sid)
    return groups


def snapshot(db, conn, ids, home, ui_root, profile):
    require_idle(db, conn, ids)
    return payload(db, conn, ids, home, ui_root, profile)


def normalized_segments(db, segments):
    if not isinstance(segments, list) or not segments or len(segments) > db._IMPORT_MAX_SESSIONS:
        raise ValueError('invalid portable segments')
    normalized, errors = db._validate_import_payload(segments)
    if errors:
        raise ValueError(f'invalid portable history: {errors}')
    return normalized


def import_rows(db, conn, segments, profile, *, replace=False):
    from hermes_state_mutation_retirement import retired_in
    normalized = normalized_segments(db, segments)
    parents = []
    for item in normalized:
        raw, messages = item['session'], item['messages']
        sid = raw['id']
        if retired_in(conn, sid):
            raise ValueError('remote history attempts to resurrect a locally deleted identity')
        if not replace and raw.get('title'):
            from hermes_state_titles import next_title_in_lineage
            raw = dict(raw, title=next_title_in_lineage(conn, raw['title']))
        if replace:
            conn.execute('DELETE FROM messages WHERE session_id=?', (sid,))
        db._import_session_row(conn, raw, messages, sid, replace_existing=replace)
        conn.execute('UPDATE sessions SET profile_name=?,parent_session_id=NULL,runtime_revision=runtime_revision+1 WHERE id=?',
                     (profile, sid))
        if raw.get('parent_session_id'):
            parents.append((sid, raw['parent_session_id']))
    db._attach_import_parents(conn, parents)


def local_target_snapshot(conn, root):
    from hermes_state_local import POLICY_PREFIX, local_lineage_owner
    from hermes_state_local_lineage import validate_local_lineage, _routed_entry
    receipt = get_meta(conn, POLICY_PREFIX + local_lineage_owner(conn, root))
    if receipt is None:
        return None
    tip = validate_local_lineage(conn, receipt)
    routed = _routed_entry(conn, receipt['route'], tip)
    if routed is None:
        raise ValueError('local conversation route changed')
    return receipt, routed


def reconcile_local_target(conn, root, remote_ids, saved):
    """Bind imported history to this device's existing owner, never the remote writer."""
    if saved is None:
        return
    from hermes_state_local_lineage import _untracked_steps, validate_local_lineage, _commit_local_target
    receipt, routed = saved
    old_lineage = receipt.get('lineage', [receipt['session_id']])
    steps = _untracked_steps(conn, root, [])
    if steps is None or {root, *steps} != set(remote_ids) or root not in old_lineage:
        raise ValueError('remote history is not one local compression lineage')
    lineage = old_lineage[:old_lineage.index(root)] + [root, *steps]
    for sid in remote_ids:
        conn.execute('UPDATE sessions SET session_key=?,chat_id=?,user_id=?,chat_type=?,origin_json=? WHERE id=?',
                     (receipt['route'], receipt['session_id'], receipt['principal_id'],
                      'dm', dumps(receipt['entry']['origin']), sid))
    receipt['lineage'] = lineage
    receipt['entry'] = dict(receipt['entry'], session_id=lineage[-1])
    validate_local_lineage(conn, receipt)
    _commit_local_target(conn, receipt, dict(routed, session_id=lineage[-1]))


def apply_record(db, conn, record, home, ui_root, profile, *, portable_hash=None):
    """Import and record its base in the SAME transaction; replay cannot overwrite new work."""
    from hermes_state_mutation_retirement import retire_sessions, retired_in
    key, revision = record['key'], record['revision']
    previous = get_meta(conn, PREFIX + key, {})
    if int(previous.get('revision', '0')) >= int(revision):
        return []
    groups = lineage_groups(conn)
    root = key.split('/', 2)[2]
    ids = groups.get(root, previous.get('ids', []))
    existing = [sid for sid in ids if conn.execute('SELECT 1 FROM sessions WHERE id=?', (sid,)).fetchone()]
    affected = delete_targets(conn, root) if existing else []
    if record['deleted']:
        existing = [sid for sid in affected if conn.execute('SELECT 1 FROM sessions WHERE id=?', (sid,)).fetchone()]
    remote_ids = [s['id'] for s in (record.get('payload') or {}).get('segments', [])]
    # The remote cannot commandeer a different existing conversation using a forged segment id.
    for sid in remote_ids:
        if sid not in existing and conn.execute('SELECT 1 FROM sessions WHERE id=?', (sid,)).fetchone():
            raise ValueError('remote segment collides with another conversation')
    require_idle(db, conn, list(set(affected + existing + remote_ids)))
    local, local_blobs = payload(db, conn, existing, home, ui_root, profile) if existing else (None, {})
    local_hash = digest(local) if local else None
    remote_hash = portable_hash if not record['deleted'] else None
    changed = []
    diverged = bool(existing) and local_hash != previous.get('hash') and local_hash != remote_hash
    if diverged:
        from hermes_cli.cloud_sync_apply import materialize, store_blob
        for blob in local_blobs.values():
            store_blob(home, blob)
        copies = remap_conflict(materialize(local, home, home)['segments'], key, revision)
        import_rows(db, conn, copies, profile)
        changed.extend(s['id'] for s in copies)
    if not record['deleted'] and any(retired_in(conn, sid) for sid in remote_ids):
        # A local deletion awaiting upload wins the original identity; preserve incoming work separately.
        copies = remap_conflict(record['payload']['segments'], key, revision)
        import_rows(db, conn, copies, profile)
        changed.extend(s['id'] for s in copies)
        put_meta(conn, PREFIX + key, {'revision': revision, 'hash': remote_hash, 'ids': remote_ids})
        return changed
    if record['deleted']:
        retire_sessions(conn, existing)
        for sid in existing:
            db._bump_conversation_generation(conn, sid, 'session_reset')
            conn.execute('UPDATE sessions SET parent_session_id=NULL WHERE parent_session_id=?', (sid,))
            conn.execute('DELETE FROM messages WHERE session_id=?', (sid,))
            conn.execute('DELETE FROM sessions WHERE id=?', (sid,))
        changed.extend(existing)
    elif local_hash != remote_hash:
        saved_target = local_target_snapshot(conn, root)
        # Move a title with its lineage tip without colliding with the replaced tip.
        for sid in existing:
            conn.execute('UPDATE sessions SET title=NULL WHERE id=?', (sid,))
        # Imported rows are history, never new admissions or resumable crash markers.
        import_rows(db, conn, record['payload']['segments'], profile, replace=True)
        removed = set(existing) - set(remote_ids)
        for sid in removed:
            conn.execute('UPDATE sessions SET parent_session_id=NULL WHERE id=?', (sid,))
        reconcile_local_target(conn, root, remote_ids, saved_target)
        retire_sessions(conn, list(removed))
        for sid in removed:
            db._bump_conversation_generation(conn, sid, 'session_reset')
            conn.execute('UPDATE sessions SET parent_session_id=NULL WHERE parent_session_id=?', (sid,))
            conn.execute('DELETE FROM messages WHERE session_id=?', (sid,))
            conn.execute('DELETE FROM sessions WHERE id=?', (sid,))
        changed.extend(set(existing + remote_ids))
    for sid in changed:
        put_meta(conn, GENERATION + sid, revision)
    put_meta(conn, PREFIX + key, {'revision': revision, 'hash': remote_hash, 'ids': remote_ids,
                                'deleted': record['deleted']})
    return changed
