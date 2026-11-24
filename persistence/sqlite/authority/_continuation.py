"""Exact interrupted-input continuations and their retained media."""
from persistence.core.errors import AuthorityRefusal as RuntimeStoreError

def _unstarted_result(value):
    from persistence.authority.vocabulary import UNSTARTED_INTERRUPT_EXIT_REASON
    return (value.get('turn_exit_reason') == UNSTARTED_INTERRUPT_EXIT_REASON
            and value.get('interrupted') is True
            and not any(value.get(key) for key in ('failed', 'error', 'partial')))


def _deferred_descriptor(conn, row):
    """Only an exact pre-loop receipt may restore input; zero API calls proves nothing."""
    from ._runtime import _row
    from ..conversation._store.terminal import RESULT_PREFIX, load_result

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




def paused_media_references(conn):
    """The latest resumable early pause, or its pending continuation, still owns its attachments."""
    from ._runtime import _row
    from ..conversation._store.terminal import RESULT_PREFIX, load_result
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


def check_continuation(conn, session_id, principal_id, token):
    old = conn.execute('SELECT * FROM session_admissions WHERE admission_id=?',
                       (token['admission_id'],)).fetchone()
    session = conn.execute('SELECT runtime_generation,runtime_revision FROM sessions WHERE id=?',
                           (session_id,)).fetchone()
    if (old is None or session is None
            or old['target_session_id'] != session_id
            or old['principal_id'] != principal_id
            or old['status'] != 'terminal' or old['outcome'] != 'interrupted'
            or old['generation'] != token['execution_generation']
            or session['runtime_generation'] != token['execution_generation']
            or session['runtime_revision'] != token['revision']
            or conn.execute('SELECT 1 FROM session_admissions WHERE target_session_id=? AND seq>? LIMIT 1',
                            (session_id, old['seq'])).fetchone() is not None):
        raise RuntimeStoreError('stale_continuation')
