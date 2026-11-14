"""An explicit continuation is a new admission against one settled interrupted turn."""
from contextlib import contextmanager
from contextvars import ContextVar
import asyncio

from hermes_state_runtime import RuntimeStoreError

_continuation: ContextVar[dict | None] = ContextVar('unstarted_continuation', default=None)


def admit_continuation(token):
    return {'continuation_v1': token} if token is not None else {}


def continuation_guard(ref, principal_id, token, prior_guard=None):
    """Fence NEW admissions in their owning transaction; exact retries remain idempotent."""
    if token is None:
        return prior_guard
    if (not isinstance(token, dict)
            or set(token) != {'admission_id', 'execution_generation', 'revision'}
            or not isinstance(token['admission_id'], str) or not token['admission_id']
            or type(token['execution_generation']) is not int
            or token['execution_generation'] < 1
            or type(token['revision']) is not int or token['revision'] < 0):
        raise RuntimeStoreError('invalid_params')

    def authorize(conn):
        if prior_guard is not None:
            prior_guard(conn)
        old = conn.execute('SELECT * FROM session_admissions WHERE admission_id=?',
                           (token['admission_id'],)).fetchone()
        session = conn.execute('SELECT runtime_generation,runtime_revision FROM sessions WHERE id=?',
                               (ref.session_id,)).fetchone()
        if (old is None or session is None
                or old['target_session_id'] != ref.session_id
                or old['principal_id'] != principal_id
                or old['status'] != 'terminal' or old['outcome'] != 'interrupted'
                or old['generation'] != token['execution_generation']
                or session['runtime_generation'] != token['execution_generation']
                or session['runtime_revision'] != token['revision']
                or conn.execute('SELECT 1 FROM session_admissions WHERE target_session_id=? AND seq>? LIMIT 1',
                                (ref.session_id, old['seq'])).fetchone() is not None):
            raise RuntimeStoreError('stale_continuation')

    return authorize


def _unstarted_result(value):
    from agent.turn_failure_copy import UNSTARTED_INTERRUPT_EXIT_REASON
    return (value.get('turn_exit_reason') == UNSTARTED_INTERRUPT_EXIT_REASON
            and value.get('interrupted') is True
            and not any(value.get(key) for key in ('failed', 'error', 'partial')))


def _deferred_descriptor(conn, row):
    """Only an exact pre-loop receipt may restore input; zero API calls proves nothing."""
    from hermes_state_runtime import _row
    from hermes_state_terminal import RESULT_PREFIX, load_result

    current = row
    while (token := current['payload'].get('continuation_v1')) is not None:
        old = conn.execute('SELECT * FROM session_admissions WHERE admission_id=?',
                           (token['admission_id'],)).fetchone()
        if (old is None or old['target_session_id'] != row['target_session_id']
                or old['principal_id'] != row['principal_id'] or old['status'] != 'terminal'
                or old['outcome'] != 'interrupted' or old['generation'] != token['execution_generation']
                or old['seq'] >= current['seq']):
            raise RuntimeStoreError('stale_continuation')
        saved = conn.execute('SELECT value FROM state_meta WHERE key=?',
                             (RESULT_PREFIX + old['admission_id'],)).fetchone()
        if saved is None or not _unstarted_result(load_result(saved[0])['result']):
            return None
        current = _row(old)
    if current is row:
        return None
    payload = {key: current['payload'][key] for key in ('text', 'attachments_v1', 'display_v1')
               if key in current['payload']}
    return {'admission_id': current['admission_id'], 'submission_id': current['request_id'], 'payload': payload}


def continuation_descriptor(db, row):
    if not row['payload'].get('continuation_v1'):
        return None
    with db._read_ctx() as conn:
        return _deferred_descriptor(conn, row)


def worker_continuation(authority, row):
    descriptor = (row['_continuation_descriptor'] if '_continuation_descriptor' in row else
                  continuation_descriptor(getattr(authority, 'db', None), row))
    return {'continuation_v1': descriptor} if descriptor else {}


async def prepare_continuation(authority, ref, row, policy):
    if not row['payload'].get('continuation_v1'):
        return None, None
    descriptor = await asyncio.to_thread(continuation_descriptor, authority.db, row)
    if descriptor is None or '@' not in descriptor['payload']['text']:
        return descriptor, None
    from gateway.session_context_refs import inbound_references, managed_turn_text
    from gateway.session_ingress import _execution_scope
    with await _execution_scope(authority, None):
        if policy is not None:
            text, refusal = await managed_turn_text(authority, {'payload': descriptor['payload']}, policy)
        else:
            live = authority.sessions[ref.session_id]
            text, refusal = await inbound_references(authority.runner, live.source, live.route,
                                                    descriptor['payload']['text'])
    if text is not None:
        descriptor = {**descriptor, 'payload': {**descriptor['payload'], 'text': text}}
    return descriptor, refusal


def restore_continuation(descriptor):
    if descriptor is None:
        return None
    if (not isinstance(descriptor, dict) or set(descriptor) != {'admission_id', 'submission_id', 'payload'}
            or not all(isinstance(descriptor[key], str) and descriptor[key]
                       for key in ('admission_id', 'submission_id'))
            or not isinstance(descriptor['payload'], dict)
            or set(descriptor['payload']) - {'text', 'attachments_v1', 'display_v1'}
            or not isinstance(descriptor['payload'].get('text'), str)):
        raise RuntimeStoreError('invalid_params')
    if 'display_v1' in descriptor['payload']:
        from gateway.session_display import restore_display
        restore_display(descriptor['payload']['display_v1'])
    return descriptor


@contextmanager
def continuation_turn_scope(descriptor):
    token = _continuation.set(restore_continuation(descriptor))
    try:
        yield
    finally:
        _continuation.reset(token)


def continuation_history(history):
    """Stage original input for the existing post-lease flush, never write beside another holder."""
    descriptor = _continuation.get()
    if descriptor is None:
        return history
    from agent.agent_runtime_helpers_placeholders import hidden_interrupt_placeholder_row
    from agent.session_persistence import _PERSIST_AFTER_ADMISSION_INTERRUPT

    original = next((message for message in history
                     if (message.get('platform_message_id') or message.get('message_id')) == descriptor['admission_id']), None)
    if original is not None:
        return history
    payload = descriptor['payload']
    content = payload['text']
    if 'attachments_v1' in payload:
        from agent.image_routing import build_native_content_parts, build_persist_user_message
        from gateway.session_ingress_media import restore_attachments
        paths = restore_attachments(payload)['media_urls']
        native, skipped = build_native_content_parts(content, paths)
        if skipped:
            raise RuntimeStoreError('invalid_params')
        content = build_persist_user_message(content, paths, native)
    user = {'role': 'user', 'content': content, 'platform_message_id': descriptor['admission_id'],
            'display_metadata': {'submission_id': descriptor['submission_id']},
            _PERSIST_AFTER_ADMISSION_INTERRUPT: True}
    display = payload.get('display_v1') or {}
    if display.get('kind'):
        user['display_kind'] = display['kind']
    if display.get('title_preview'):
        user['display_metadata']['title_preview'] = display['title_preview']
    boundary = {**hidden_interrupt_placeholder_row(), _PERSIST_AFTER_ADMISSION_INTERRUPT: True}
    return [*history, user, boundary]


def paused_media_references(conn):
    """The latest resumable early pause, or its pending continuation, still owns its attachments."""
    from hermes_state_runtime import _row
    from hermes_state_terminal import RESULT_PREFIX, load_result
    rows = conn.execute('''SELECT * FROM session_admissions WHERE seq IN (
        SELECT MAX(seq) FROM session_admissions GROUP BY target_session_id)
        AND (json_type(payload_json, '$.attachments_v1.media') IS NOT NULL
             OR json_type(payload_json, '$.continuation_v1') IS NOT NULL)''').fetchall()
    references = []
    for saved in rows:
        row = _row(saved)
        if row['status'] == 'terminal':
            receipt = conn.execute('SELECT value FROM state_meta WHERE key=?',
                                   (RESULT_PREFIX + row['admission_id'],)).fetchone()
            if (row['outcome'] != 'interrupted' or receipt is None
                    or not _unstarted_result(load_result(receipt[0])['result'])):
                continue
            payload = row['payload']
        else:
            payload = {}
        descriptor = _deferred_descriptor(conn, row)
        if descriptor:
            payload = descriptor['payload']
        references.extend(payload.get('attachments_v1', {}).get('media', ()))
    return references
