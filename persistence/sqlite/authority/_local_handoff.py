"""Work/Code relationships carried by the existing local reservation transaction."""
import json
from persistence.core.errors import AuthorityRefusal as RuntimeStoreError


def _work_code_source(conn, session_id, principal, target_mode, owner=None):
    """Check again inside the creation transaction: a deleted/moved source cannot leave an orphan
    relation. Operator access alone never moves another account's context to a new owner's chat."""
    from session_rules.legacy_local import same_owner
    from ..conversation._store.local import POLICY_PREFIX
    found = conn.execute('SELECT value FROM state_meta WHERE key=?', (POLICY_PREFIX + session_id,)).fetchone()
    row = conn.execute('SELECT id FROM sessions WHERE id=?', (session_id,)).fetchone()
    if not row or not found:
        raise RuntimeStoreError('not_found')
    receipt = json.loads(found[0])
    if not same_owner(receipt['principal_id'], principal, owner):
        raise RuntimeStoreError('permission_denied')
    mode = receipt['policy'].get('execution_mode', 'work')
    if mode == target_mode:
        raise RuntimeStoreError('invalid_params', field='execution_mode', detail='handoff must change modes')
    return receipt


def work_code_creation_fields(conn, receipt, owner=None):
    """Use the existing independent-branch lifecycle, not compression/subagent ancestry. The
    reviewed draft and parent marker commit with the child's route and frozen policy."""
    request = json.loads(receipt['policy']['request_json'])
    handoff = request.get('handoff')
    if handoff is None:
        return None, None
    parent = handoff['source_session_id']
    _work_code_source(conn, parent, receipt['principal_id'], receipt['policy'].get('execution_mode', 'work'), owner)
    return parent, json.dumps({'_branched_from': parent})


def title_work_code_child(db, conn, receipt):
    from .._schema import next_title_in_lineage
    request = json.loads(receipt['policy']['request_json'])
    handoff = request.get('handoff')
    if handoff is None:
        return
    explicit = request.get('handoff_title')
    from persistence.conversation.sessions import sanitize_title
    from ..conversation._store.titles import _set_session_title_in_transaction
    from .._schema import TITLE_SOURCE_USER, TITLE_SOURCE_DERIVED
    title = explicit or sanitize_title(handoff['summary'].strip().splitlines()[0][:120]) or 'Work / Code'
    try:
        _set_session_title_in_transaction(db, conn, receipt['session_id'],
            title if explicit else next_title_in_lineage(conn, title),
            source=TITLE_SOURCE_USER if explicit else TITLE_SOURCE_DERIVED)
    except ValueError as exc:
        raise RuntimeStoreError('admission_conflict', field='title') from exc


def work_code_links(db, session_id, owner=None):
    """Project durable links, not copied history. Deleted sources are simply no longer navigable.
    Read both ends from creation receipts so normal branches/compression children are not handoffs."""
    from session_rules.legacy_local import owners_agree
    from ..conversation._store.local import POLICY_PREFIX
    with db._read_ctx() as conn:
        found = conn.execute('SELECT m.value,s.model_config FROM state_meta m JOIN sessions s ON m.key=? || s.id '
                             'WHERE s.id=?', (POLICY_PREFIX, session_id)).fetchone()
        if not found:
            return {}
        receipt = json.loads(found[0])
        handoff = _reviewed_handoff(receipt, found['model_config'])
        parent = handoff['source_session_id'] if handoff else None
        rows = conn.execute('SELECT s.id,s.title,s.model_config,m.value FROM sessions s JOIN state_meta m ON m.key=? || s.id '
                            'WHERE s.parent_session_id=? OR s.id=? ORDER BY s.started_at,s.id',
                            (POLICY_PREFIX, session_id, parent)).fetchall()
        links = []
        for row in rows:
            linked = json.loads(row['value'])
            if not owners_agree(receipt['principal_id'], linked['principal_id'], owner):
                continue
            relation = 'source' if row['id'] == parent else 'child'
            context = _reviewed_handoff(linked, row['model_config'])
            if relation == 'child' and (not context or context['source_session_id'] != session_id):
                continue
            links.append({'session_id': row['id'], 'title': row['title'] or '',
                          'execution_mode': linked['policy'].get('execution_mode', 'work'), 'relation': relation})
    return {'linked_sessions': links, **({'handoff': handoff} if handoff else {})}


def _reviewed_handoff(receipt, model_config):
    """Normal branches copy launch policy, not the act of handing work between engines."""
    from ..conversation._store.sessions import _parse_model_config
    handoff = json.loads(receipt['policy']['request_json']).get('handoff')
    marker = _parse_model_config(model_config).get('_branched_from')
    return handoff if handoff and marker == handoff['source_session_id'] else None
