"""Validation, media materialization and replay-safe remote application."""
from __future__ import annotations

import base64
import hashlib
from pathlib import Path
import re

from hermes_cli.cloud_sync_portable import (
    MAX_BLOB, MAX_DOCUMENT, META_FIELDS, NAME, SHA, SESSION_FIELDS, digest, dumps,
    map_media, model_config, safe_child,
)
from hermes_state_cloud_sync import PREFIX, apply_record, get_meta, put_meta

REVISION = re.compile(r'(0|[1-9][0-9]{0,39})\Z')


def revision(value):
    if not isinstance(value, str) or not REVISION.fullmatch(value):
        raise ValueError('invalid revision or cursor')
    return int(value)


def blob_path(home, sha):
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError('invalid blob SHA256')
    return safe_child(home, 'cloud-sync', 'media', sha)


def store_blob(home, item):
    from hermes_cli.cloud_sync_media import publish_media
    sha = item['sha256']
    path = blob_path(home, sha)
    data = base64.b64decode(item['data_base64'], validate=True)
    if len(data) > MAX_BLOB or hashlib.sha256(data).hexdigest() != sha:
        raise ValueError('blob size or SHA256 mismatch')
    publish_media(home, path, data)


def load_blob(home, sha):
    from hermes_cli.cloud_sync_portable import AttachmentTooLarge, read_owned
    path = blob_path(home, sha)
    if not path.exists():
        return None
    try:
        data = read_owned(path, (home,))
    except AttachmentTooLarge:
        return None
    if hashlib.sha256(data).hexdigest() != sha:
        return None
    return {'sha256': sha, 'data_base64': base64.b64encode(data).decode()}


def validate_document(record):
    document = record['payload']
    if not isinstance(document, dict) or document.get('schema') != 1 or len(dumps(document).encode()) > MAX_DOCUMENT:
        raise ValueError('invalid portable document')
    profile = document.get('profile')
    if not isinstance(profile, dict) or profile.get('id') != record['key'].split('/')[1]:
        raise ValueError('document profile differs from record key')
    if set(profile.get('metadata', {})) - {*META_FIELDS, 'bot_title'}:
        raise ValueError('unportable profile metadata')
    config = profile.get('config', {})
    if not isinstance(config, dict) or set(config) - {'model'}:
        raise ValueError('unportable profile configuration')
    model = config.get('model')
    if model is not None and not isinstance(model, (str, dict)):
        raise ValueError('invalid profile model')
    if isinstance(model, dict) and set(model) - {'provider', 'model', 'name', 'reasoning_effort'}:
        raise ValueError('unportable model configuration')
    segments = document.get('segments')
    if not isinstance(segments, list) or not segments:
        raise ValueError('document has no conversation segments')
    ids = [s.get('id') for s in segments if isinstance(s, dict)]
    if len(ids) != len(segments) or len(ids) != len(set(ids)) or record['key'].split('/')[2] not in ids:
        raise ValueError('invalid conversation segment identities')
    if any(not isinstance(sid, str) or not NAME.fullmatch(sid) for sid in ids):
        raise ValueError('unsafe conversation identity')
    for segment in segments:
        if segment.get('parent_session_id') and segment['parent_session_id'] not in ids:
            raise ValueError('conversation parent escapes document')
        if set(segment) - {*SESSION_FIELDS, 'model_config', 'messages'}:
            raise ValueError('unportable session fields')
        if model_config(segment.get('model_config')) != (segment.get('model_config') or {}):
            raise ValueError('unportable session model configuration')
    attachments = document.get('attachments')
    if not isinstance(attachments, list):
        raise ValueError('invalid attachment inventory')
    hashes = {a['sha256'] for a in attachments}
    if len(hashes) != len(attachments):
        raise ValueError('duplicate attachment inventory entry')
    for attachment in attachments:
        if not SHA.fullmatch(attachment['sha256']) or not isinstance(attachment.get('size'), int) or not 0 <= attachment['size'] <= MAX_BLOB:
            raise ValueError('invalid attachment inventory entry')
    referenced = set()
    def validate_ref(value):
        if not value.startswith('cloud-blob:') or value[11:] not in hashes:
            raise ValueError('unowned or undeclared remote attachment')
        referenced.add(value[11:])
        return value
    map_media(segments, validate_ref)
    if referenced != hashes:
        raise ValueError('attachment inventory differs from references')
    return hashes


def validate_response(preparation, response):
    if not isinstance(response, dict) or set(response) != {'cursor', 'has_more', 'results', 'changes'}:
        raise ValueError('invalid exchange response')
    if len(dumps(response).encode()) > 16 * 1024 * 1024:
        raise ValueError('exchange response exceeds 16 MiB')
    cursor = revision(response['cursor'])
    if cursor < revision(preparation['exchange']['after']) or not isinstance(response['has_more'], bool):
        raise ValueError('backwards cursor or invalid pagination')
    results, changes = response['results'], response['changes']
    if not isinstance(results, list) or not isinstance(changes, list) or len(changes) > 50:
        raise ValueError('invalid exchange result arrays')
    operations = {o['operation_id']: o for o in preparation['exchange']['operations']}
    if len(results) != len(operations) or {r['operation_id'] for r in results} != set(operations):
        raise ValueError('operation results differ from persisted preparation')
    for result in results:
        if result['status'] not in ('applied', 'conflict') or result['record']['key'] != operations[result['operation_id']]['key']:
            raise ValueError('operation result does not match preparation')
        if result['status'] == 'applied':
            op, record = operations[result['operation_id']], result['record']
            if op['deleted'] != record['deleted'] or op.get('payload') != record.get('payload'):
                raise ValueError('applied operation content differs from preparation')
    if any(revision(record['revision']) > cursor for record in changes):
        raise ValueError('change revision exceeds cursor')
    records = [r['record'] for r in results] + changes
    hashes = set()
    for record in records:
        parts = record['key'].split('/')
        if len(parts) != 3 or parts[0] != 'conversation' or any(not NAME.fullmatch(p) for p in parts[1:]) or len(record['key']) > 256:
            raise ValueError('invalid conversation key')
        if not 0 < revision(record['revision']) or not isinstance(record.get('deleted'), bool):
            raise ValueError('invalid record revision or deletion flag')
        if record['deleted']:
            if record.get('payload') is not None:
                raise ValueError('tombstone has a payload')
        else:
            hashes.update(validate_document(record))
    return records, hashes


def publish_profile(home, profile):
    """Publish only owned descriptive settings using existing config writers."""
    if profile['id'] == 'default':
        return
    from hermes_cli.config import atomic_config_write
    from hermes_cli.config_backend import config_exists, read_config_doc
    from hermes_cli.profiles import write_profile_meta
    from utils import atomic_yaml_write
    directory = safe_child(home, 'profiles', profile['id'])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ('config.yaml', 'profile.yaml', 'state.db'):
        safe_child(directory, name)
    meta = dict(profile.get('metadata') or {})
    title = meta.pop('bot_title', None)
    write_profile_meta(directory, **{k: v for k, v in meta.items() if k in META_FIELDS})
    if title:
        current = read_config_doc(directory / 'profile.yaml') or {}
        current.setdefault('ui_meta', {}).setdefault('hermes-bots', {})['title'] = title
        atomic_yaml_write(directory / 'profile.yaml', current, sort_keys=False)
    if profile.get('config'):
        path = directory / 'config.yaml'
        current = read_config_doc(path) if config_exists(path) else {}
        current = current or {}
        incoming = profile['config']
        if isinstance(current.get('model'), dict) and isinstance(incoming.get('model'), dict):
            incoming = {'model': {**current['model'], **incoming['model']}}
        atomic_config_write(path, {**current, **incoming})


def media_suffix(data):
    """Content-derived extension for the existing desktop preview MIME ladder."""
    signatures = ((b'\x89PNG\r\n\x1a\n', '.png'), (b'\xff\xd8\xff', '.jpg'),
                  (b'GIF87a', '.gif'), (b'GIF89a', '.gif'), (b'%PDF-', '.pdf'),
                  (b'ID3', '.mp3'), (b'OggS', '.ogg'))
    for magic, suffix in signatures:
        if data.startswith(magic):
            return suffix
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return '.webp'
    if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
        return '.wav'
    if data[4:8] == b'ftyp':
        return '.mp4'
    return '.bin'


def materialize(document, source_home, target_home):
    import copy
    value = copy.deepcopy(document)
    for attachment in value['attachments']:
        blob = load_blob(source_home, attachment['sha256'])
        if blob is None:
            raise ValueError('downloaded attachment disappeared')
        store_blob(target_home, blob)
        data = base64.b64decode(blob['data_base64'], validate=True)
        display_path = safe_child(target_home, 'cloud-sync', 'media', attachment['sha256'] + media_suffix(data))
        from hermes_cli.cloud_sync_media import publish_media
        publish_media(target_home, display_path, data)
    def local_ref(value):
        if not value.startswith('cloud-blob:'):
            raise ValueError('remote attachment path is not portable')
        blob = load_blob(source_home, value[11:])
        suffix = media_suffix(base64.b64decode(blob['data_base64'], validate=True))
        return str(safe_child(target_home, 'cloud-sync', 'media', value[11:] + suffix))
    value['segments'] = map_media(value['segments'], local_ref)
    return value


def apply_one(db, conn, home, ui_root, state, record, accepted):
    from hermes_state import SessionDB
    from hermes_cli.cloud_sync_engine import issue
    profile = record['key'].split('/')[1]
    directory = home if profile == 'default' else safe_child(home, 'profiles', profile)
    if not record['deleted'] and not directory.exists():
        publish_profile(home, record['payload']['profile'])
    if not directory.exists():
        state['known'][record['key']] = {'revision': record['revision'], 'deleted': True, 'ids': [], 'hash': None}
        return []
    safe_child(directory, 'state.db')
    other = db if directory == home else SessionDB(directory / 'state.db')
    def apply_to(connection):
        previous = get_meta(connection, PREFIX + record['key'], {})
        if int(previous.get('revision', '0')) >= int(record['revision']):
            return []
        if record['key'] in accepted and accepted[record['key']] == record['revision']:
            # Our accepted snapshot becomes the common ancestor; newer local turns stay local.
            put_meta(connection, PREFIX + record['key'], {
                'revision': record['revision'], 'hash': None if record['deleted'] else digest(record['payload']),
                'ids': [] if record['deleted'] else [s['id'] for s in record['payload']['segments']],
                'deleted': record['deleted']})
            return []
        local_record = dict(record)
        if not record['deleted']:
            local_record['payload'] = materialize(record['payload'], home, directory)
        # Hash comparisons must stay on portable content, not materialized filesystem paths.
        changed = apply_record(other, connection, local_record, directory, ui_root, profile,
                               portable_hash=None if record['deleted'] else digest(record['payload']))
        if not record['deleted']:
            publish_profile(home, record['payload']['profile'])
        return changed
    try:
        if other is db:
            conn.execute('SAVEPOINT cloud_sync_record')
        changed = apply_to(conn) if other is db else other._execute_write(apply_to)
        state['known'][record['key']] = {'revision': record['revision'],
            'deleted': record['deleted'], 'hash': None if record['deleted'] else digest(record['payload']),
            'ids': [] if record['deleted'] else [s['id'] for s in record['payload']['segments']]}
        if changed:
            from tui_gateway.turn_marker import clear_turn_marker
            for sid in changed:
                clear_turn_marker(directory, sid)
        return changed
    except (RuntimeError, ValueError, OSError) as exc:
        if other is db:
            conn.execute('ROLLBACK TO cloud_sync_record')
        issue(state, record['key'], exc)
        return None
    finally:
        if other is db:
            conn.execute('RELEASE cloud_sync_record')
        if other is not db:
            other.close()


def apply(db, conn, home, ui_root, state, request):
    from hermes_cli.cloud_sync_engine import status, uuid_text
    request_id = uuid_text(request.get('request_id'))
    response = request['response']
    response_hash = digest(response)
    receipt = state['receipts'].get(request_id)
    if receipt:
        if receipt['hash'] != response_hash:
            raise ValueError('response differs from completed preparation')
        return {**receipt['result'], 'status': status(state)}
    preparation = state.get('preparation')
    if not preparation or preparation['request_id'] != request_id:
        raise ValueError('unknown persisted preparation')
    if preparation.get('response_hash', response_hash) != response_hash:
        raise ValueError('response differs from persisted preparation')
    records, hashes = validate_response(preparation, response)
    preparation['response_hash'], preparation['response'] = response_hash, response
    for blob in request.get('blobs', []):
        if blob['sha256'] not in hashes:
            raise ValueError('unsolicited blob')
        store_blob(home, blob)
    missing = sorted(sha for sha in hashes if load_blob(home, sha) is None)
    state['issues'] = list(state.get('local_issues', []))
    initial_issues = len(state['issues'])
    result = {'ok': True, 'request_id': request_id, 'changed_session_ids': [], 'changed_profile_ids': [],
              'pending_downloads': missing, 'has_more': response['has_more']}
    preparation['pending_downloads'] = missing
    if missing:
        return {**result, 'status': status(state)}
    accepted = {r['record']['key']: r['record']['revision'] for r in response['results'] if r['status'] == 'applied'}
    unique = {(r['key'], r['revision']): r for r in records}
    for record in sorted(unique.values(), key=lambda r: int(r['revision'])):
        changed = apply_one(db, conn, home, ui_root, state, record, accepted)
        if changed is not None:
            result['changed_session_ids'].extend(changed)
            if changed:
                result['changed_profile_ids'].append(record['key'].split('/')[1])
    result['changed_session_ids'] = sorted(set(result['changed_session_ids']))
    result['changed_profile_ids'] = sorted(set(result['changed_profile_ids']))
    if len(state['issues']) == initial_issues:
        completed = {r['operation_id'] for r in response['results']}
        state['outbox'] = [o for o in state['outbox'] if o['operation_id'] not in completed]
        state['cursor'] = response['cursor']
        del state['preparation']
        state['receipts'][request_id] = {'hash': response_hash, 'result': result}
        order = state.setdefault('receipt_order', [])
        order.append(request_id)
        while len(order) > 128:
            state['receipts'].pop(order.pop(0), None)
    return {**result, 'status': status(state)}
