"""Authenticated legacy adoption. Sources stay readable and permanently non-executable."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict
from pathlib import Path

from hermes_state import SessionDB
from gateway import hosted_rooms
from gateway.hosted_room_conversation_migration import ConversationMigrationStore
from tui_gateway.conversation_authority import request_owner_key


def _psutil_source_holders():
    """Portable fallback: an uninspectable same-owner process is not an empty result."""
    import psutil
    owner = psutil.Process().username()
    for process in psutil.process_iter(['pid', 'username']):
        if process.pid == os.getpid():
            continue
        try:
            yield from (entry.path for entry in process.open_files())
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied as exc:
            if process.info.get('username') in (None, owner):
                raise ValueError('cannot inspect a same-owner source database holder; retry after it exits') from exc


def _require_quiet_holders(path):
    """Use the existing native DB-descriptor inventory; never stop a source holder."""
    import sys
    from hermes_state_holders import canonical_sqlite_path
    names = {canonical_sqlite_path(str(path.resolve()) + suffix) for suffix in ('', '-wal', '-shm', '-journal')}
    if sys.platform == 'darwin':
        from hermes_state_dbfile import _iter_darwin_fd_targets
        targets = (target for pid, _fd, target, _identity, writable in
                   _iter_darwin_fd_targets(include_write_access=True)
                   if pid != os.getpid() and writable is not False)
    elif sys.platform.startswith('linux'):
        from hermes_state_dbfile import _iter_proc_fd_targets
        targets = (target for pid, target, _fd, writable in _iter_proc_fd_targets(include_write_access=True)
                   if pid != os.getpid() and writable is not False)
    else:
        targets = _psutil_source_holders()
    try:
        held = any(canonical_sqlite_path(target) in names for target in targets)
    except OSError as exc:
        raise ValueError('source database holder inventory is unavailable') from exc
    if held:
        raise ValueError('another process holds the source database; close that source before adopting')


def adopt_session(server, *, source_profile, lineage_id, conversation_id, input_id):
    from gateway.hosted_room_conversation_maintenance import managed_operation
    service = server.get_conversation_service()
    with managed_operation(service.db_path.parent), service._lock:
        return _adopt(service, source_profile, lineage_id, conversation_id, input_id)


def _completed_retry(service, *, owner, source_profile, lineage_id, conversation_id, input_id, migration_id):
    from gateway.hosted_room_conversation_owners import require_owner_locked
    with hosted_rooms._transaction(service.db_path) as conn:
        stored = conn.execute('SELECT * FROM hosted_conversation_migrations WHERE migration_id=? OR input_id=? OR conversation_id=?',
                              (migration_id, input_id, conversation_id)).fetchall()
        if not stored:
            return None
        row = stored[0]
        if len(stored) != 1 or any(row[key] != value for key, value in {
                'migration_id': migration_id, 'input_id': input_id, 'conversation_id': conversation_id,
                'owner_key': owner}.items()):
            raise ValueError('migration identity conflicts with an existing receipt')
        require_owner_locked(conn, conversation_id, owner)
        result = json.loads(row['receipt_json'])
        if result['source_profile'] != source_profile or lineage_id not in result['source_session_ids']:
            raise ValueError('migration source identity conflicts with its receipt')
        if result['status'] != 'complete':
            return None
    # Completed import is immutable even when the conversation is renamed, archived,
    # refreshed, restored, or creation is later disabled. Only repair the source ACK.
    home = Path(service.server._profile_home(source_profile) or service.server._hermes_home)
    if not (home / 'state.db').is_file():
        raise ValueError('source session database is unavailable')
    with SessionDB(home / 'state.db') as db:
        if db.get_session_migration(lineage_id) is None:
            raise ValueError('completed migration source receipt is unavailable')
        receipt, _manifest = db.prepare_conversation_migration(source_profile=source_profile,
            lineage_id=lineage_id, conversation_id=conversation_id, input_id=input_id,
            migration_id=migration_id, owner_key=owner)
        if (receipt.source_lineage_id != result['source_lineage_id'] or
                receipt.source_cutoff_row_id != result['source_cutoff_row_id'] or
                set(receipt.source_session_ids) != set(result['source_session_ids'])):
            raise ValueError('source receipt differs from the completed migration')
        if receipt.status != 'complete':
            db.set_conversation_migration_status(migration_id, 'complete')
    return result


def _adopt(service, source_profile, lineage_id, conversation_id, input_id):
    server = service.server
    owner = request_owner_key(server, write=True)
    from gateway.hosted_room_conversation_owners import LOCAL_OWNER
    from tui_gateway.transport import current_transport
    from tui_gateway.ws import is_install_owner_transport
    peer = current_transport()
    if owner == LOCAL_OWNER and peer is not server._stdio_transport and not is_install_owner_transport(peer):
        raise ValueError('ownerless legacy history may only be adopted by its local owner transport')
    if not all(isinstance(v, str) and v.strip() for v in (source_profile, lineage_id, conversation_id, input_id)):
        raise ValueError('migration identifiers must not be empty')
    migration_id = 'migration:' + hashlib.sha256(f'{owner}\0{source_profile}\0{input_id}'.encode()).hexdigest()
    completed = _completed_retry(service, owner=owner, source_profile=source_profile,
        lineage_id=lineage_id, conversation_id=conversation_id, input_id=input_id, migration_id=migration_id)
    if completed is not None:
        return completed
    if not service.capabilities()['enabled']:
        raise ValueError('conversation adoption is not enabled')
    # Catalog lookup validates Profile identity; _profile_home is never given a client path.
    catalog = service.catalog()
    source = next((r for r in catalog if r['participant']['profile'] == source_profile and r['available']), None)
    general = next((r for r in catalog if r['participant']['is_general'] and r['available']), None)
    if source is None or general is None:
        raise ValueError('source or general participant is unavailable')
    home = Path(server._profile_home(source_profile) or server._hermes_home)
    path = home / 'state.db'
    if not path.is_file():
        raise ValueError('source session database is unavailable')
    _require_quiet_holders(path)
    from gateway.hosted_room_conversation_migration import migration_receipt
    with hosted_rooms._transaction(service.db_path) as conn:
        existing = conn.execute('SELECT 1 FROM hosted_rooms WHERE room_id=?', (conversation_id,)).fetchone()
        previous = migration_receipt(conn, conversation_id)
        if existing and (not previous or previous['migration_id'] != migration_id):
            raise ValueError('adoption requires a new conversation identity')
        conflict = conn.execute('SELECT migration_id FROM hosted_conversation_migrations WHERE input_id=?', (input_id,)).fetchone()
        if conflict and conflict['migration_id'] != migration_id:
            raise ValueError('migration input identity conflicts')
    # Warm agents may have work admitted without a persisted user row yet.
    with server._sessions_lock:
        for session in server._sessions.values():
            if Path(session.get('profile_home') or server._hermes_home) == home and session.get('session_key') == lineage_id and (
                    session.get('running') or session.get('busy') or session.get('queue')):
                raise ValueError('source runtime has pending work')
    with SessionDB(path) as db:
        from .conversation_attachments import max_attachment_bytes
        attachment_limit = max_attachment_bytes(service.db_path)
        with server._profile_build_scope(home):
            receipt, manifest = db.prepare_conversation_migration(source_profile=source_profile,
                lineage_id=lineage_id, conversation_id=conversation_id, input_id=input_id,
                migration_id=migration_id, owner_key=owner, max_attachment_bytes=attachment_limit)
        shared = ConversationMigrationStore(service.store)
        try:
            from gateway.hosted_room_conversation_types import ParticipantRef
            general_ref = ParticipantRef(**general['participant'])
            participant = ParticipantRef(**source['participant'])
            # A source from default is still the same honest author; other Profiles stay experts.
            title = (db.get_session(lineage_id).get('title') or 'Imported conversation').strip()[:hosted_rooms.MAX_ROOM_NAME_CHARS] or 'Imported conversation'
            service.store.create(conversation_id, title, general_ref, None, owner_key=owner,
                migration_import=(receipt, input_id, manifest))
            shared.begin(receipt, input_id=input_id, owner_key=owner, manifest=manifest)
            service.store.bind_participant(conversation_id, participant)
            db.set_conversation_migration_status(migration_id, 'importing')
            from .conversation_attachments import ConversationAttachments
            attachments = ConversationAttachments(service)
            for row in manifest:
                public_attachments = [attachments.attach(conversation_id, **item)['attachment']
                                      for item in row.get('attachments', ())]
                shared.import_row(receipt, {**row, 'public_attachments': public_attachments}, participant)
            service.prepare(conversation_id, participant.participant_id)
            result = shared.finish(receipt)
            db.set_conversation_migration_status(migration_id, 'complete')
            # No cache/ACK is copied. The fresh generation's actual context receipt
            # records imported events only when its first turn receives them.
            return result
        except Exception as exc:
            db.set_conversation_migration_status(migration_id, 'failed', str(exc))
            shared.fail(receipt, exc)
            raise


def adopt_conversation(service, **params):
    return {'migration': adopt_session(service.server, **params)}
