"""``handoff.request`` / ``handoff.state`` / ``handoff.fail`` on the shared owner (Desktop and CLI
``/handoff``), as the per-TUI sidecar serves them (``tui_gateway/methods_session.py``).

The owner only writes the session row's ``pending`` handoff; the gateway's handoff watcher claims it,
repoints the platform's home route at the session and runs the synthetic turn there. ``dispatch``
runs each handler under the owning profile's scope, so the gateway config read here (platform and
home channel) is that profile's, the one the watcher delivers through. SQLite runs off the owner loop.
"""
import asyncio
import json
from dataclasses import replace
from functools import partial

from gateway.session_busy_controls import authorize
from hermes_state_runtime import RuntimeStoreError


def validate_work_code_handoff(params):
    """A new Work/Code conversation, unlike a platform handoff, never moves the original lane.
    Keep the reviewed context in the frozen creation request so exact retries compare it too."""
    if 'handoff' not in params:
        return params
    from pydantic import ValidationError
    from tui_gateway.contracts.canonical import WorkCodeHandoff
    try:
        handoff = WorkCodeHandoff.model_validate(params['handoff']).model_dump()
    except ValidationError as exc:
        raise RuntimeStoreError('invalid_params', field='handoff') from exc
    if params.get('source') != 'gui' or params.get('execution_mode') not in {'work', 'code'}:
        raise RuntimeStoreError('invalid_params', field='execution_mode')
    return {**params, 'handoff': handoff}


def authorize_work_code_handoff(authority, actor, params):
    handoff = params.get('handoff')
    if handoff is None:
        return
    from gateway.session_contract import SessionRef
    ref = SessionRef(authority.profile_id, handoff['source_session_id'])
    authority.authorize(actor, ref, 'session:read')
    with authority.db._read_ctx() as conn:
        _work_code_source(conn, handoff['source_session_id'], actor.subject, params['execution_mode'])


def with_handoff_title(policy, title):
    request = json.loads(policy.request_json)
    if request.get('handoff') is None or title is None:
        return policy
    return replace(policy, request_json=json.dumps({**request, 'handoff_title': title}, sort_keys=True))


def _work_code_source(conn, session_id, principal, target_mode):
    """Check again inside the creation transaction: a deleted/moved source cannot leave an orphan
    relation. Operator access alone never moves another account's context to a new owner's chat."""
    from gateway.owner_identity import same_owner
    from hermes_state_local import POLICY_PREFIX
    found = conn.execute('SELECT value FROM state_meta WHERE key=?', (POLICY_PREFIX + session_id,)).fetchone()
    row = conn.execute('SELECT id FROM sessions WHERE id=?', (session_id,)).fetchone()
    if not row or not found:
        raise RuntimeStoreError('not_found')
    receipt = json.loads(found[0])
    if not same_owner(receipt['principal_id'], principal):
        raise RuntimeStoreError('permission_denied')
    mode = receipt['policy'].get('execution_mode', 'work')
    if mode == target_mode:
        raise RuntimeStoreError('invalid_params', field='execution_mode', detail='handoff must change modes')
    return receipt


def work_code_creation_fields(conn, receipt):
    """Use the existing independent-branch lifecycle, not compression/subagent ancestry. The
    reviewed draft and parent marker commit with the child's route and frozen policy."""
    request = json.loads(receipt['policy']['request_json'])
    handoff = request.get('handoff')
    if handoff is None:
        return None, None
    parent = handoff['source_session_id']
    _work_code_source(conn, parent, receipt['principal_id'], receipt['policy'].get('execution_mode', 'work'))
    return parent, json.dumps({'_branched_from': parent})


def title_work_code_child(db, conn, receipt):
    from hermes_state_titles import lineage_title_on_conn
    request = json.loads(receipt['policy']['request_json'])
    handoff = request.get('handoff')
    if handoff is None:
        return
    explicit = request.get('handoff_title')
    title = explicit or db.sanitize_title(handoff['summary'].strip().splitlines()[0][:120]) or 'Work / Code'
    try:
        db._set_session_title_in_transaction(conn, receipt['session_id'],
            title if explicit else lineage_title_on_conn(conn, title),
            source=db.TITLE_SOURCE_USER if explicit else db.TITLE_SOURCE_DERIVED)
    except ValueError as exc:
        raise RuntimeStoreError('admission_conflict', field='title') from exc


def work_code_links(db, session_id):
    """Project durable links, not copied history. Deleted sources are simply no longer navigable.
    Read both ends from creation receipts so normal branches/compression children are not handoffs."""
    from gateway.owner_identity import owners_agree
    from hermes_state_local import POLICY_PREFIX
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
            if not owners_agree(receipt['principal_id'], linked['principal_id']):
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
    from hermes_state_sessions import _parse_model_config
    handoff = json.loads(receipt['policy']['request_json']).get('handoff')
    marker = _parse_model_config(model_config).get('_branched_from')
    return handoff if handoff and marker == handoff['source_session_id'] else None


def handlers(connection):
    return {'handoff.request': partial(request, connection), 'handoff.state': partial(state, connection),
            'handoff.fail': partial(fail, connection)}


def _session(connection, ref, params, fields, capability):
    if set(params) - fields or not isinstance(ref.session_id, str) or not ref.session_id:
        raise RuntimeStoreError('invalid_params')
    authorize(connection, ref, params, capability)


class HandoffRefusal(RuntimeStoreError):
    """A refusal whose wire ``message`` is the human reason, as the sidecar's handoff errors were:
    Desktop shows ``error.message`` verbatim, and a bare ``invalid_params`` never says what to fix
    (``data`` still carries the reason code, field and detail)."""

    def __init__(self, reason, detail, field=None):
        super().__init__(reason, field=field, detail=detail)
        self.wire_message = self.detail


def _destination(platform_name):
    """The home channel the watcher will deliver to, by the CLI's own rule (relay-fronted platforms
    included): an unconfigured platform or a missing home channel would otherwise sit ``pending``
    until the client gives up."""
    from gateway.handoff_target import HandoffTargetError, resolve_handoff_home
    try:
        return resolve_handoff_home(platform_name)
    except HandoffTargetError as exc:
        raise HandoffRefusal('invalid_params', _REFUSALS[exc.reason].format(platform=platform_name),
                       field='platform') from None


_REFUSALS = {'unknown_platform': "unknown platform '{platform}'",
             'platform_not_enabled': "platform '{platform}' is not configured/enabled in the gateway",
             'no_home_channel': 'no home channel configured for {platform}; set one with /sethome on the '
                                'destination chat first'}


_UNSETTLED = {'session_busy': 'wait for the current turn to finish, then retry the handoff',
              'unknown_execution': 'a turn of this session did not finish when Hermes restarted; send /discard '
                                   'in it (or resume it) first, then retry the handoff'}


def require_settled(db, session_id, conn):
    """Refuse a handoff while durable work still owns *session_id*: any queued, started or unknown
    admission, a live worker, or a live turn lease on its runtime lineage. A recovered ``unknown``
    turn has no resident drain task, yet moving its route would hand the lane a turn whose outcome
    nobody resolved. Runs on the caller's write transaction: inside ``request_handoff``'s, and again
    when the watcher repoints (``check_settled``), so a turn admitted after the request still wins."""
    from hermes_state_mutation_guards import MUTATION_GUARD_REFUSALS, require_idle
    from hermes_state_runtime_workers import runtime_lineage
    try:
        require_idle(db, conn, sorted(runtime_lineage(conn, session_id)))
    except MUTATION_GUARD_REFUSALS:
        raise HandoffRefusal('session_busy', _UNSETTLED['session_busy']) from None
    except RuntimeStoreError as exc:
        if exc.reason not in _UNSETTLED:
            raise
        raise HandoffRefusal(exc.reason, _UNSETTLED[exc.reason]) from None


async def check_settled(db, session_id):
    """The watcher's re-check of ``require_settled`` right before it repoints the route; a refusal
    fails the handoff with the human reason (the CLI and Desktop show ``handoff_error``)."""
    if db is None or not callable(getattr(db, '_execute_write', None)):
        return
    try:
        await asyncio.to_thread(db._execute_write, partial(require_settled, db, session_id))
    except HandoffRefusal as exc:
        raise RuntimeError(exc.detail) from None


async def request(connection, ref, params):
    _session(connection, ref, params, {'session_id', 'profile', 'platform'}, 'session:control')
    platform_name = params.get('platform')
    if not isinstance(platform_name, str) or not platform_name.strip():
        raise HandoffRefusal('invalid_params', 'platform required', field='platform')
    platform_name = platform_name.strip().lower()
    live = connection.authority.sessions[ref.session_id]
    if live.task is not None and not live.task.done():
        # The watcher's repoint and synthetic turn would race the running one.
        raise HandoffRefusal('session_busy', _UNSETTLED['session_busy'])
    db = connection.authority.db

    def write():
        home = _destination(platform_name)
        if not db.request_handoff(ref.session_id, platform_name, _guard=partial(require_settled, db, ref.session_id)):
            raise HandoffRefusal('session_busy', 'a handoff of this session is already in flight; wait for it to settle',
                           field='handoff')
        return home
    home = await asyncio.to_thread(write)
    return {'queued': True, 'session_key': ref.session_id, 'platform': platform_name, 'home_name': home.name}


async def state(connection, ref, params):
    _session(connection, ref, params, {'session_id', 'profile'}, 'session:read')
    record = await asyncio.to_thread(connection.authority.db.get_handoff_state, ref.session_id) or {}
    return {field: record.get(field) or '' for field in ('state', 'platform', 'error')}


async def fail(connection, ref, params):
    """A client's poll timeout: fails a handoff no watcher claimed yet. A claimed (``running``) row is
    the watcher's to settle, so the write is a compare-and-swap on ``pending``."""
    _session(connection, ref, params, {'session_id', 'profile', 'error'}, 'session:control')
    reason = params.get('error')
    reason = (reason.strip() if isinstance(reason, str) else '')[:500] or 'handoff failed'
    db = connection.authority.db

    def write():
        failed = db.fail_handoff(ref.session_id, reason, only_states=('pending',))
        return failed, (db.get_handoff_state(ref.session_id) or {}).get('state') or ''
    failed, current = await asyncio.to_thread(write)
    return {'failed': bool(failed), 'state': 'failed' if failed else current}
