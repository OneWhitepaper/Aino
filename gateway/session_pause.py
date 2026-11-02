"""An explicit continuation is a new admission against one settled interrupted turn."""
from hermes_state_runtime import RuntimeStoreError


def continuation_guard(ref, principal_id, token):
    """Fence NEW admissions in their owning transaction; exact retries remain idempotent."""
    if token is None:
        return None
    if (not isinstance(token, dict)
            or set(token) != {'admission_id', 'execution_generation', 'revision'}
            or not isinstance(token['admission_id'], str) or not token['admission_id']
            or type(token['execution_generation']) is not int
            or token['execution_generation'] < 1
            or type(token['revision']) is not int or token['revision'] < 0):
        raise RuntimeStoreError('invalid_params')

    def authorize(conn):
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
