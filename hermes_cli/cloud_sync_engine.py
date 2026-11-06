"""Durable bounded exchange state; SessionDB remains the history authority."""
from __future__ import annotations

from pathlib import Path
import uuid

from hermes_cli.cloud_sync_portable import (
    NAME, digest, dumps, safe_child,
)
from hermes_state_cloud_sync import PREFIX, get_meta, put_meta, lineage_groups, snapshot

STATE_KEY = 'cloud_sync.engine.v1'
BATCH_BYTES = 12 * 1024 * 1024


def uuid_text(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('request_id must be a canonical UUID')
    return value


def status(state):
    pending = len(state['outbox']) + bool(state.get('preparation')) + bool(state.get('more_local'))
    return {'state': 'blocked' if state['issues'] else ('pending' if pending else 'synced'),
            'pending': pending, 'cursor': state['cursor'], 'issues': state['issues']}


def issue(state, key, exc):
    state['issues'].append({'code': getattr(exc, 'reason', None) or 'blocked', 'key': key, 'message': str(exc)})


def profile_homes(home):
    yield 'default', home
    root = safe_child(home, 'profiles')
    if root.exists():
        for child in sorted(root.iterdir()):
            if NAME.fullmatch(child.name) and child.is_dir() and not child.is_symlink():
                if safe_child(child, 'state.db').exists():
                    yield child.name, child


def collect(db, home, ui_root, state):
    """Read consistent snapshots without holding a writer lock during media hashing."""
    from hermes_state import SessionDB
    state['issues'] = []
    state['more_local'] = False
    seen = set()
    queued = {operation['key'] for operation in state['outbox']}
    queued_bytes = sum(len(dumps(operation).encode()) for operation in state['outbox'])
    for profile, directory in profile_homes(home):
        other = db if directory == home else SessionDB(directory / 'state.db')
        def scan(connection):
            nonlocal queued_bytes
            groups = lineage_groups(connection)
            for root, ids in groups.items():
                key = f'conversation/{profile}/{root}'
                seen.add(key)
                if key in queued:
                    continue
                if len(queued) >= 16 or queued_bytes >= BATCH_BYTES:
                    state['more_local'] = True
                    continue
                try:
                    if len(key) > 256 or not NAME.fullmatch(root):
                        raise ValueError('conversation identity is not portable')
                    document, blobs = snapshot(other, connection, ids, directory, ui_root, profile)
                    from hermes_cli.cloud_sync_apply import store_blob
                    for blob in blobs.values():
                        store_blob(home, blob)
                    base = get_meta(connection, PREFIX + key, {})
                    state['known'][key] = {'revision': base.get('revision', '0'), 'ids': ids,
                                           'hash': base.get('hash'), 'deleted': False}
                    fingerprint = digest(document)
                    if fingerprint != base.get('hash'):
                        operation = {'operation_id': str(uuid.uuid4()), 'key': key,
                                     'base_revision': base.get('revision', '0'), 'deleted': False, 'payload': document}
                        cost = len(dumps(operation).encode())
                        if queued_bytes + cost <= BATCH_BYTES:
                            state['outbox'].append(operation)
                            queued.add(key)
                            queued_bytes += cost
                        else:
                            state['more_local'] = True
                except (ValueError, OSError, RuntimeError) as exc:
                    issue(state, key, exc)
        try:
            with other._read_ctx() as connection:
                connection.execute('BEGIN')
                try:
                    scan(connection)
                finally:
                    connection.rollback()
        finally:
            if other is not db:
                other.close()
    for key, base in list(state['known'].items()):
        if key not in seen and not base.get('deleted') and key not in queued:
            if len(queued) >= 16:
                state['more_local'] = True
                continue
            state['outbox'].append({'operation_id': str(uuid.uuid4()), 'key': key,
                                   'base_revision': base['revision'], 'deleted': True, 'payload': None})
            queued.add(key)
    state['local_issues'] = list(state['issues'])


def prepare(home, state, request):
    request_id = uuid_text(request.get('request_id'))
    if state.get('preparation'):
        return preparation_result(state)
    if request_id in state['receipts']:
        raise ValueError('request_id belongs to a completed preparation')
    selected, uploads = [], {}
    size = 0
    for operation in state['outbox']:
        attachments = (operation.get('payload') or {}).get('attachments', [])
        from hermes_cli.cloud_sync_apply import blob_path
        required = {a['sha256']: a for a in attachments}
        if any(not blob_path(home, sha).is_file() for sha in required):
            issue(state, operation['key'], ValueError('queued attachment is missing'))
            continue
        cost = len(dumps(operation).encode())
        if size + cost > BATCH_BYTES:
            if not selected:
                issue(state, operation['key'], ValueError('snapshot exceeds 12 MiB exchange budget'))
            continue
        size += cost
        selected.append(operation)
        uploads.update(required)
        if len(selected) == 16:
            break
    state['preparation'] = {'request_id': request_id,
        'exchange': {'version': 1, 'device_id': state['device_id'], 'after': state['cursor'],
                     'limit': 50, 'operations': selected}, 'uploads': list(uploads.values())}
    return preparation_result(state)


def preparation_result(state):
    result = {'ok': True, **state['preparation'], 'status': status(state)}
    result.pop('response_hash', None)
    if 'response' in result:
        result['pending_response'] = result.pop('response')
    return result


def exchange_local(request):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from hermes_state import SessionDB
    home, ui_root = Path(request['home']), Path(request['ui_root'])
    if not home.is_absolute() or not ui_root.is_absolute():
        raise ValueError('home and ui_root must be absolute paths')
    if home.is_symlink() or ui_root.is_symlink() or home.resolve() != home or ui_root.resolve() != ui_root:
        raise ValueError('account roots must be canonical paths without symlinks')
    home.mkdir(parents=True, exist_ok=True)
    safe_child(home, 'state.db')
    token = set_hermes_home_override(home)
    db = SessionDB(home / 'state.db')
    try:
        prepared_state, baseline = None, None
        if request['action'] == 'prepare':
            with db._read_ctx() as connection:
                prepared_state = get_meta(connection, STATE_KEY)
            baseline = digest(prepared_state)
            if prepared_state is None:
                prepared_state = {'cursor': '0', 'device_id': str(uuid.uuid4()), 'outbox': [],
                                  'known': {}, 'issues': [], 'receipts': {}}
            if not prepared_state.get('preparation'):
                collect(db, home, ui_root, prepared_state)
        def perform(conn):
            current = get_meta(conn, STATE_KEY)
            if prepared_state is not None and (not current or digest(current) == baseline):
                state = prepared_state
            else:
                state = current or {'cursor': '0', 'device_id': str(uuid.uuid4()), 'outbox': [],
                                    'known': {}, 'issues': [], 'receipts': {}}
                if prepared_state is not None and not state.get('preparation'):
                    raise RuntimeError('sync state changed during preparation; retry')
            device_id = request.get('device_id')
            if device_id is not None:
                if not isinstance(device_id, str) or not 1 <= len(device_id) <= 128:
                    raise ValueError('invalid device_id')
                if state.get('preparation') and device_id != state['device_id']:
                    raise ValueError('device_id changed during pending preparation')
                state['device_id'] = device_id
            action = request['action']
            if action == 'status':
                result = {'ok': True, 'status': status(state)}
            elif action == 'prepare':
                result = prepare(home, state, request)
            elif action == 'read_blob':
                from hermes_cli.cloud_sync_apply import load_blob
                blob = load_blob(home, request['sha256'])
                if blob is None:
                    raise ValueError('unknown staged blob')
                result = {'ok': True, **blob}
            else:
                from hermes_cli.cloud_sync_apply import apply
                result = apply(db, conn, home, ui_root, state, request)
            put_meta(conn, STATE_KEY, state)
            return result
        return db._execute_write(perform)
    finally:
        db.close()
        reset_hermes_home_override(token)
