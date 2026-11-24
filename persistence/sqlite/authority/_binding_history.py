"""Control-only ownership of unbound legacy history: the history-control record, an import's binding of its new ids,
the authorization (a read, or a claim inside a receipted mutation), the claim check the gateway ran before it, and the
owner test the delete walk runs on each chain member. The actor is the contract's ``HistoryActor``: its
``may_create`` is the gateway's reading of its capabilities. Stored owners and bindings compare through the owner
rule (``session_rules.legacy_local.same_owner``) under the caller's ``OwnerRule``, ``owner``."""

import json

from persistence.core.errors import AuthorityRefusal
from session_rules.legacy_local import (
    binding_names, bindings_agree, legacy_account_label, legacy_history_row, owners_agree, same_owner,
)


BINDING_PREFIX = 'gateway.history_control.v1.'


def _history_row(row, owner):
    """Local surfaces' unrouted rows are owner history: every row the native resume adopts
    (``legacy_history_row``: old ``desktop`` chats, ``oneshot``/``tool`` CLI runs and a client app's
    self-labelled chats too) plus imports. A row resume can adopt must also take a sidebar edit
    (pin/archive/hide/rename)."""
    return row['source'] == 'import' or legacy_history_row(dict(row), owner)


def _owner_user(row):
    """The row's owner identity; main's Desktop Nous-account label is not one (see validate_legacy_row)."""
    return None if legacy_account_label(dict(row)) else row['user_id']


def import_history_control(conn, actor, session_ids):
    binding = json.dumps([actor.profile_id, actor.subject], separators=(',', ':'))
    for sid in session_ids:
        if conn.execute('SELECT 1 FROM sessions WHERE id=?', (sid,)).fetchone() is None:
            conn.execute('INSERT INTO state_meta(key,value) VALUES(?,?)', (BINDING_PREFIX + sid, binding))


def authorize_history(conn, actor, session_id, *, claim=False, owner=None):
    row = conn.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
    if row is None:
        return False
    # Import intentionally strips routes. Never reinterpret a cold native/API
    # transcript as imported history, even if stale import metadata exists.
    if row['session_key'] or row['chat_id'] or row['origin_json']:
        return False
    key = BINDING_PREFIX + session_id
    binding = json.dumps([actor.profile_id, actor.subject], separators=(',', ':'))
    saved = conn.execute('SELECT value FROM state_meta WHERE key=?', (key,)).fetchone()
    if saved is not None:
        if not binding_names(saved[0], actor.subject, owner):
            raise AuthorityRefusal('permission_denied')
        return True
    if not _history_row(row, owner):
        return False
    if _owner_user(row) and not same_owner(row['user_id'], actor.subject, owner):
        raise AuthorityRefusal('permission_denied')
    if not actor.may_create:
        raise AuthorityRefusal('permission_denied')
    if claim:
        conn.execute('INSERT INTO state_meta(key,value) VALUES(?,?)', (key, binding))
    return True


def history_binding(conn, session_id):
    saved = conn.execute('SELECT value FROM state_meta WHERE key=?', (BINDING_PREFIX + session_id,)).fetchone()
    return saved[0] if saved else None


def same_history_owner(conn, anchor_id, session_id, owner=None):
    """Whether chain member ``session_id`` is history the authorizer of ``anchor_id`` controls.

    A real compression continuation copies its parent's route columns, so a routed member must
    carry the anchor's exact (user_id, session_key, chat_id). A routeless member needs a binding
    naming the anchor's owner; unbound, it must also pass :func:`authorize_history`'s local
    rule (legacy history, no foreign user_id), as the pre-adoption ancestors of an adopted
    legacy CLI conversation do, or share an unbound routeless anchor's source (an old cron run's or
    subagent's own compression chain, mounted as one chat). A bound (imported) anchor therefore
    never reaches unbound rows.
    """
    columns = 'SELECT source,user_id,session_key,chat_id,origin_json FROM sessions WHERE id=?'
    anchor, row = (conn.execute(columns, (sid,)).fetchone() for sid in (anchor_id, session_id))
    if anchor is None or row is None:
        return False
    if row['session_key'] or row['chat_id'] or row['origin_json']:
        return tuple(row)[1:4] == tuple(anchor)[1:4]
    binding = history_binding(conn, session_id)
    if not bindings_agree(binding, history_binding(conn, anchor_id), owner):
        return False
    routeless_peer = row['source'] == anchor['source'] and not any(tuple(anchor)[2:5])
    return binding is not None or (
        (_history_row(row, owner) or routeless_peer)
        and (_owner_user(row) in (None, '') or owners_agree(_owner_user(row), anchor['user_id'], owner)))


def require_history_claim(holder, conn, actor, sid, native_transport, owner=None):
    """Import receipts confer ownership; merely knowing an old ID does not. *native_transport* is whether the
    owner's native transport registry holds the actor."""
    from ..conversation._store.sessions import _own_profile_name
    row = conn.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
    if row is None or row['session_key'] or row['chat_id'] or row['origin_json']:
        return
    if conn.execute('SELECT 1 FROM state_meta WHERE key=?', (BINDING_PREFIX + sid,)).fetchone():
        return  # authorize_history checks the already committed importer identity.
    own_profile = row['profile_name'] in (None, '', _own_profile_name(holder) or 'default')
    if own_profile and _owner_user(row) and same_owner(row['user_id'], actor.subject, owner):
        return  # Its owner (a login stamp is the machine owner's); authorize_history re-checks it.
    if not native_transport:
        raise AuthorityRefusal('permission_denied')


def authorize_history_read(holder, actor, session_id, native_transport=None, owner=None):
    """The claim check (unless *native_transport* is None, the listing's read) and the authorization, in one read."""
    with holder._read_ctx() as conn:
        if native_transport is not None:
            require_history_claim(holder, conn, actor, session_id, native_transport, owner)
        return authorize_history(conn, actor, session_id, owner=owner)


def restore_import_execution(db, conn, actor, sessions, owner=None):
    """Repair only this importer's untouched transcript-only copies, inside the import transaction.

    Never rewrite a live policy, a native/messaging route, a foreign import or edited history.
    Generic imports remain insert/skip; native recovery opts into this narrow repair explicitly.
    """
    from ..conversation._store.local import POLICY_PREFIX
    from persistence.authority.vocabulary import LEGACY_LOCAL_SOURCES
    from ..conversation._store.sessions import _parse_model_config
    for session in sessions:
        sid = session['id']
        row = conn.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if (row is None or row['source'] not in LEGACY_LOCAL_SOURCES | {'local'}
                or any(row[key] for key in ('session_key', 'chat_id', 'origin_json'))
                or conn.execute('SELECT 1 FROM state_meta WHERE key=?', (POLICY_PREFIX + sid,)).fetchone()):
            continue
        config = _parse_model_config(session.get('model_config'))
        if config.get('execution_mode') not in ('work', 'code') or session.get('source') not in LEGACY_LOCAL_SOURCES:
            continue
        binding = history_binding(conn, sid)
        if binding is None or not binding_names(binding, actor.subject, owner):
            raise AuthorityRefusal('permission_denied')
        if _parse_model_config(row['model_config']).get('platform_owner') != config.get('platform_owner'):
            raise AuthorityRefusal('permission_denied')
        _require_matching_import(db, conn, sid, session)
        revision = session.get('_recovery_revision')
        if type(revision) is not int or revision != row['runtime_revision']:
            raise AuthorityRefusal('revision_conflict')
        from ._runtime_guards import require_idle
        require_idle(db, conn, [sid])
        conn.execute('UPDATE sessions SET source=?,user_id=NULL,model=?,model_config=?,cwd=?,runtime_revision=runtime_revision+1 WHERE id=?',
                     (session['source'], session.get('model'), json.dumps(config), session.get('cwd'), sid))


def _require_matching_import(db, conn, sid, session):
    rows = conn.execute('SELECT * FROM messages WHERE session_id=? ORDER BY id', (sid,)).fetchall()
    from ..conversation._store.messages import _row_to_message_dict
    current = [_row_to_message_dict(db, row, warn_context='history recovery', summary_flag=True) for row in rows]
    def portable(messages):
        return json.dumps([{key: value for key, value in message.items() if key not in ('id', 'session_id')}
                           for message in messages], sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    if portable(current) != portable(session.get('messages', [])):
        raise AuthorityRefusal('admission_conflict', detail='history changed since recovery inspection')
