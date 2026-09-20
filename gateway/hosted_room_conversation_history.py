"""Owned immutable branches and explicit new-attempt relationships for public history."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict

from gateway import hosted_rooms
from gateway.hosted_room_conversation_admission import ConversationBusyError
from gateway.hosted_room_conversation_maintenance import managed_store
from gateway.hosted_room_conversation_owners import require_owner_locked
from gateway.hosted_room_conversation_types import TurnSubmission

_MESSAGE_KINDS = ('conversation.input', 'conversation.response', 'conversation.continuation')


def _encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def initialize_history_schema(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_command_intents (
        conversation_id TEXT NOT NULL,input_id TEXT NOT NULL,PRIMARY KEY(conversation_id,input_id))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_draft_cancellations (
        conversation_id TEXT PRIMARY KEY,input_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_json TEXT NOT NULL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_branches (
        conversation_id TEXT PRIMARY KEY REFERENCES hosted_room_conversations(conversation_id),
        owner_key TEXT NOT NULL, operation_id TEXT NOT NULL, request_json TEXT NOT NULL,
        receipt_json TEXT NOT NULL, UNIQUE(owner_key,operation_id))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_branch_events (
        conversation_id TEXT NOT NULL, event_id TEXT NOT NULL, source_conversation_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL, source_seq INTEGER NOT NULL, payload_sha256 TEXT NOT NULL,
        PRIMARY KEY(conversation_id,event_id))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_input_relations (
        conversation_id TEXT NOT NULL, input_id TEXT NOT NULL, submission_json TEXT NOT NULL,
        relation_json TEXT NOT NULL, PRIMARY KEY(conversation_id,input_id))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_regenerations (
        conversation_id TEXT NOT NULL, input_id TEXT NOT NULL, owner_key TEXT NOT NULL,
        request_json TEXT NOT NULL, command INTEGER NOT NULL,
        PRIMARY KEY(conversation_id,input_id))''')


def _has_table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def branch_receipt(conn, conversation_id):
    if not _has_table(conn, 'hosted_conversation_branches'):
        return None
    row = conn.execute('SELECT receipt_json FROM hosted_conversation_branches WHERE conversation_id=?', (conversation_id,)).fetchone()
    if not row:
        return None
    receipt = json.loads(row['receipt_json'])
    draft = receipt.get('draft')
    receipt['draft_cancelled'] = _has_table(conn, 'hosted_conversation_draft_cancellations') and bool(conn.execute(
        'SELECT 1 FROM hosted_conversation_draft_cancellations WHERE conversation_id=?', (conversation_id,)).fetchone())
    receipt['draft_pending'] = bool(draft and not receipt['draft_cancelled'] and not conn.execute(
        'SELECT 1 FROM hosted_room_conversation_inputs WHERE conversation_id=? AND input_id=?',
        (conversation_id, draft['input_id'])).fetchone())
    return receipt


def event_provenance(conn, conversation_id, event_id):
    if not _has_table(conn, 'hosted_conversation_branch_events'):
        return None
    row = conn.execute('''SELECT source_conversation_id AS conversation_id,source_event_id AS event_id,
        source_seq AS seq,payload_sha256 FROM hosted_conversation_branch_events WHERE conversation_id=? AND event_id=?''',
        (conversation_id, event_id)).fetchone()
    return dict(row) if row else None


def input_relation_locked(conn, conversation_id, submission, command_resolution=None):
    if not _has_table(conn, 'hosted_conversation_input_relations'):
        return {}
    if _has_table(conn, 'hosted_conversation_draft_cancellations') and conn.execute('SELECT 1 FROM hosted_conversation_draft_cancellations WHERE conversation_id=? AND input_id=?',
                    (conversation_id, submission.input_id)).fetchone():
        raise hosted_rooms.RoomConflictError('edited draft was cancelled')
    row = conn.execute('SELECT * FROM hosted_conversation_input_relations WHERE conversation_id=? AND input_id=?',
                       (conversation_id, submission.input_id)).fetchone()
    if not row:
        return {}
    expected = json.loads(row['submission_json'])
    if command_resolution is not None:
        # The normal command path authenticates and consumes this exact owner's token.
        # Its canonical display may differ only in command spelling/whitespace.
        raw = expected['text']
        parts = raw.strip().lstrip('/').split(maxsplit=1) if raw.lstrip().startswith('/') else []
        canonical = '/' + parts[0].lower() + (' ' + parts[1] if len(parts) > 1 else '') if parts else None
        if canonical == command_resolution['display']:
            expected['text'] = canonical
    if _encoded(expected) != _encoded(asdict(submission)):
        raise hosted_rooms.RoomConflictError('history action input identity or content changed')
    return {'history_relation': json.loads(row['relation_json'])}


def terminal_relation(store, conversation_id, input_id):
    with hosted_rooms._transaction(store.db_path) as conn:
        if not _has_table(conn, 'hosted_conversation_input_relations'):
            return {}
        row = conn.execute('SELECT relation_json FROM hosted_conversation_input_relations WHERE conversation_id=? AND input_id=?',
                           (conversation_id, input_id)).fetchone()
        return {'history_relation': json.loads(row['relation_json'])} if row else {}


def _event(conn, conversation_id, event_id):
    row = conn.execute('SELECT * FROM hosted_room_events WHERE room_id=? AND event_id=?', (conversation_id, event_id)).fetchone()
    if row is None or row['kind'] not in _MESSAGE_KINDS:
        raise hosted_rooms.RoomNotFoundError('public message event is unavailable')
    return row


def _idle_source(store, conn, conversation_id, expected_revision):
    from .hosted_room_conversation_migration import require_migration_complete
    require_migration_complete(conn, conversation_id)
    record = store._check_admission_locked(conn, conversation_id, expected_revision)
    if _has_table(conn, 'hosted_conversation_background_origins') and conn.execute(
            "SELECT 1 FROM hosted_conversation_background_origins WHERE conversation_id=? AND state NOT IN ('completed','rejected','cancelled') LIMIT 1",
            (conversation_id,)).fetchone():
        raise ConversationBusyError('source has unsettled background work')
    if _has_table(conn, 'hosted_conversation_output_reservations') and conn.execute(
            'SELECT 1 FROM hosted_conversation_output_reservations WHERE conversation_id=? LIMIT 1', (conversation_id,)).fetchone():
        raise ConversationBusyError('source has an unpublished result')
    return record


def _read_text(conn, conversation_id, payload):
    if payload.get('content_status') == 'unsupported':
        raise ValueError('source message has no retained complete text')
    if payload.get('content_ref'):
        from .hosted_room_conversation_content import read_owned_locked, validate_reference_locked
        validate_reference_locked(conn, conversation_id, payload['content_ref'], text=True)
        return read_owned_locked(conn, conversation_id, payload['content_ref']['id']).decode('utf-8')
    return str(payload.get('text') or '')


def _command_intent(conn, conversation_id, input_id):
    inherited = conn.execute('SELECT 1 FROM hosted_conversation_command_intents WHERE conversation_id=? AND input_id=?',
                             (conversation_id,input_id)).fetchone()
    consumed = _has_table(conn, 'hosted_conversation_command_tokens') and conn.execute(
        'SELECT 1 FROM hosted_conversation_command_tokens WHERE conversation_id=? AND consumed_input_id=?',
        (conversation_id,input_id)).fetchone()
    return bool(inherited or consumed)


@managed_store
class ConversationHistoryStore:
    def __init__(self, store):
        self.store, self.db_path = store, store.db_path
        from .hosted_room_conversation_content import ConversationContentStore
        self.content = ConversationContentStore(self.db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            initialize_history_schema(conn)
            from tui_gateway.conversation_attachments import _initialize
            _initialize(conn)

    def _charge_history(self, conn, conversation_id, operation_key, text, *serialized):
        from .hosted_room_conversation_content import ContentQuotaError, storage_limits
        from .hosted_room_conversation_budget import check_bytes
        limits = storage_limits(self.db_path)
        if len(text.encode('utf-8')) > limits['max_content_bytes']:
            raise ContentQuotaError('History draft exceeds the configured content budget')
        size = sum(len(value.encode('utf-8')) for value in serialized)
        check_bytes(conn,conversation_id,size,limits)
        self.content._disk_admission(size,limits)
        conn.execute('INSERT INTO hosted_conversation_history_storage VALUES (?,?,?)',
                     (conversation_id,operation_key,size))

    def _copy_content(self, conn, source, target, payload):
        from .hosted_room_conversation_content import validate_reference_locked, storage_limits
        from tui_gateway.conversation_attachments import attachment_locked
        limits = storage_limits(self.db_path)
        if payload.get('content_ref'):
            ref = validate_reference_locked(conn, source, payload['content_ref'], text=True)
            self.content._associate(conn, target, ref, limits)
        advertised = {item['id']: item for item in payload.get('attachments', ())}
        ids = payload.get('attachment_ids', ())
        if set(advertised) - set(ids):
            raise ValueError('source attachment references are inconsistent')
        for attachment_id in ids:
            attachment = attachment_locked(conn, source, attachment_id)
            if attachment_id in advertised and advertised[attachment_id] != attachment:
                raise ValueError('source attachment provenance differs from stored content')
            ref = validate_reference_locked(conn, source, attachment['content_ref'])
            self.content._associate(conn, target, ref, limits)
            conn.execute('INSERT OR IGNORE INTO hosted_conversation_attachments VALUES (?,?,?,?)',
                         (target, attachment_id, attachment['filename'], ref.id))

    def branch(self, *, owner_key, conversation_id, source_event_id, expected_revision,
               target_conversation_id, operation_id, edit_text=None):
        target_conversation_id = hosted_rooms._room_id(target_conversation_id)
        operation_id = hosted_rooms._event_id(operation_id)
        request = dict(conversation_id=conversation_id, source_event_id=source_event_id,
            expected_revision=expected_revision, target_conversation_id=target_conversation_id,
            operation_id=operation_id, edit_text=edit_text)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            require_owner_locked(conn, conversation_id, owner_key)
            previous = conn.execute('SELECT * FROM hosted_conversation_branches WHERE (owner_key=? AND operation_id=?) OR conversation_id=?',
                                    (owner_key, operation_id, target_conversation_id)).fetchall()
            if previous:
                if len(previous) != 1 or previous[0]['owner_key'] != owner_key or previous[0]['request_json'] != _encoded(request):
                    raise hosted_rooms.RoomConflictError('branch identity was reused with different source or edit')
                require_owner_locked(conn, target_conversation_id, owner_key)
                return branch_receipt(conn, target_conversation_id)
            if conversation_id == target_conversation_id or conn.execute('SELECT 1 FROM hosted_rooms WHERE room_id=?', (target_conversation_id,)).fetchone():
                raise hosted_rooms.RoomConflictError('branch requires a new conversation identity')
            source = _idle_source(self.store, conn, conversation_id, expected_revision)
            selected = _event(conn, conversation_id, source_event_id)
            source_payload = json.loads(selected['payload_json'])
            if edit_text is not None and selected['kind'] != 'conversation.input':
                raise ValueError('only a public user input can be edited')
            cutoff = selected['seq'] - int(edit_text is not None)
            self.store._create_locked(conn, target_conversation_id, source.title, source.general, source.project, owner_key=owner_key)
            conn.execute('''INSERT INTO hosted_room_conversation_participants
                (conversation_id,participant_id,install_id,profile,display_name,is_general,session_generation,lineage_id)
                SELECT ?,participant_id,install_id,profile,display_name,is_general,1,NULL
                FROM hosted_room_conversation_participants WHERE conversation_id=? AND is_general=0''',
                (target_conversation_id, conversation_id))
            room = conn.execute('SELECT authority_gateway_id,authority_epoch FROM hosted_rooms WHERE room_id=?', (target_conversation_id,)).fetchone()
            rows = conn.execute('SELECT * FROM hosted_room_events WHERE room_id=? AND seq<=? ORDER BY seq', (conversation_id, cutoff)).fetchall()
            for row in rows:
                payload = json.loads(row['payload_json'])
                self._copy_content(conn, conversation_id, target_conversation_id, payload)
                event = hosted_rooms._append_event_locked(conn, room_id=target_conversation_id, purpose='conversation',
                    event_id=row['event_id'], kind=row['kind'], normalized_actor=json.loads(row['actor_json']),
                    actor_json=row['actor_json'], payload_json=row['payload_json'],
                    authority_gateway_id=room['authority_gateway_id'], authority_epoch=room['authority_epoch'], now=row['created_at'])
                conn.execute('INSERT INTO hosted_conversation_branch_events VALUES (?,?,?,?,?,?)',
                    (target_conversation_id, event['event_id'], conversation_id, row['event_id'], row['seq'],
                     hashlib.sha256(row['payload_json'].encode()).hexdigest()))
                if row['kind'] == 'conversation.input' and _command_intent(conn,conversation_id,payload.get('input_id')):
                    conn.execute('INSERT INTO hosted_conversation_command_intents VALUES (?,?)',
                                 (target_conversation_id,payload['input_id']))
                # Historical public inputs are replayable identities, never newly queued tasks.
                copied = conn.execute('''INSERT INTO hosted_room_conversation_inputs
                    SELECT ?,turn_id,input_id,event_id,participant_id,text,attachment_ids_json,author_id,
                        author_display_name,target_display_name,? FROM hosted_room_conversation_inputs
                    WHERE conversation_id=? AND event_id=?''', (target_conversation_id, event['seq'], conversation_id, row['event_id']))
                if row['kind'] == 'conversation.input' and not copied.rowcount:
                    # Imported public inputs have no execution index in their source.
                    actor = json.loads(row['actor_json'])
                    conn.execute('''INSERT INTO hosted_room_conversation_inputs VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
                        (target_conversation_id,payload['turn_id'],payload['input_id'],row['event_id'],
                         payload['target_participant_id'],_read_text(conn,conversation_id,payload),
                         hosted_rooms._canonical_json(payload.get('attachment_ids', []), label='attachment_ids', max_bytes=64*1024),
                         actor['id'],payload.get('author_display_name_at_time',actor.get('display_name','User')),
                         payload['target_display_name_at_time'],event['seq']))
            # Event timestamps retain provenance; the new conversation itself was created now.
            conn.execute('UPDATE hosted_rooms SET updated_at=created_at WHERE room_id=?', (target_conversation_id,))
            draft = None
            if edit_text is not None:
                self._copy_content(conn, conversation_id, target_conversation_id, source_payload)
                participant_id = source_payload['target_participant_id']
                suffix = hashlib.sha256(f'{owner_key}\0{operation_id}\0{target_conversation_id}'.encode()).hexdigest()
                submission = TurnSubmission('edit-turn:' + suffix, 'edit-input:' + suffix, participant_id,
                                            edit_text, tuple(source_payload.get('attachment_ids', ())))
                if not edit_text.strip() and not submission.attachment_ids:
                    raise ValueError('edited input needs text or attachments')
                relation = {'kind': 'edit', 'conversation_id': conversation_id, 'event_id': source_event_id}
                conn.execute('INSERT INTO hosted_conversation_input_relations VALUES (?,?,?,?)',
                             (target_conversation_id, submission.input_id, _encoded(asdict(submission)), _encoded(relation)))
                draft = {**asdict(submission), 'source_event_id': source_event_id}
            receipt = dict(operation_id=operation_id, conversation_id=target_conversation_id,
                source_conversation_id=conversation_id, source_event_id=source_event_id,
                source_revision=expected_revision, source_cutoff_seq=cutoff,
                kind='edit' if edit_text is not None else 'branch', draft=draft)
            retained = [_encoded(request),_encoded(receipt)]
            if draft is not None:
                retained.extend((_encoded(asdict(submission)),_encoded(relation)))
            self._charge_history(conn,target_conversation_id,'branch',edit_text or '',*retained)
            conn.execute('INSERT INTO hosted_conversation_branches VALUES (?,?,?,?,?)',
                         (target_conversation_id, owner_key, operation_id, _encoded(request), _encoded(receipt)))
            return branch_receipt(conn, target_conversation_id)

    def regeneration(self, *, owner_key, conversation_id, source_event_id, expected_revision, input_id, turn_id):
        input_id, turn_id = hosted_rooms._event_id(input_id), hosted_rooms._event_id(turn_id)
        request = dict(conversation_id=conversation_id, source_event_id=source_event_id,
                       expected_revision=expected_revision, input_id=input_id, turn_id=turn_id)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            require_owner_locked(conn, conversation_id, owner_key)
            previous = conn.execute('SELECT * FROM hosted_conversation_regenerations WHERE conversation_id=? AND input_id=?',
                                    (conversation_id, input_id)).fetchone()
            if previous and (previous['owner_key'] != owner_key or previous['request_json'] != _encoded(request)):
                raise hosted_rooms.RoomConflictError('regenerate identity was reused with another result')
            if previous:
                row = conn.execute('SELECT * FROM hosted_room_conversation_inputs WHERE conversation_id=? AND input_id=?',
                                   (conversation_id, input_id)).fetchone()
                if row:
                    from .hosted_room_conversation_store import _admission_from_row
                    return {'admission': asdict(_admission_from_row(row, idempotent=True))}
            _idle_source(self.store, conn, conversation_id, expected_revision)
            result = _event(conn, conversation_id, source_event_id)
            payload, actor = json.loads(result['payload_json']), json.loads(result['actor_json'])
            if result['kind'] != 'conversation.response' or payload.get('status') not in ('settled','failed','cancelled'):
                raise ValueError('regenerate requires a terminal public response; uncertain work needs recovery')
            original = _event(conn, conversation_id, payload.get('reply_to_event_id'))
            if original['kind'] != 'conversation.input':
                raise ValueError('response has no exact public input relation')
            original_payload = json.loads(original['payload_json'])
            participant_id = actor['id']
            if original_payload.get('target_participant_id') != participant_id:
                raise ValueError('response author differs from the original input recipient')
            submission = TurnSubmission(turn_id, input_id, participant_id,
                _read_text(conn, conversation_id, original_payload), tuple(original_payload.get('attachment_ids', ())))
            if conn.execute('SELECT 1 FROM hosted_room_conversation_inputs WHERE conversation_id=? AND (input_id=? OR turn_id=?)',
                            (conversation_id, input_id, turn_id)).fetchone():
                raise hosted_rooms.RoomConflictError('regenerate requires a new input and turn identity')
            relation = {'kind': 'regenerate', 'conversation_id': conversation_id, 'event_id': source_event_id}
            command = _command_intent(conn,conversation_id,original_payload.get('input_id'))
            if not previous:
                self._charge_history(conn,conversation_id,'regenerate:' + input_id,submission.text,
                                     _encoded(asdict(submission)),_encoded(relation),_encoded(request))
                conn.execute('INSERT INTO hosted_conversation_input_relations VALUES (?,?,?,?)',
                             (conversation_id,input_id,_encoded(asdict(submission)),_encoded(relation)))
                conn.execute('INSERT INTO hosted_conversation_regenerations VALUES (?,?,?,?,?)',
                             (conversation_id,input_id,owner_key,_encoded(request),int(command)))
            return {'submission': asdict(submission), 'command': bool(command)}

    def cancel_draft(self, *, owner_key, conversation_id, input_id, operation_id, expected_revision):
        operation_id = hosted_rooms._event_id(operation_id)
        request = _encoded(dict(input_id=input_id,operation_id=operation_id,expected_revision=expected_revision))
        with hosted_rooms._transaction(self.db_path,immediate=True) as conn:
            require_owner_locked(conn,conversation_id,owner_key)
            old = conn.execute('SELECT * FROM hosted_conversation_draft_cancellations WHERE conversation_id=?',
                               (conversation_id,)).fetchone()
            if old:
                if old['request_json'] != request:
                    raise hosted_rooms.RoomConflictError('draft cancellation identity changed')
                return
            record = self.store._get_locked(conn,conversation_id)
            if record.revision != expected_revision:
                raise hosted_rooms.RoomConflictError('conversation revision changed')
            receipt = branch_receipt(conn,conversation_id)
            if not receipt or not receipt['draft_pending'] or receipt['draft']['input_id'] != input_id:
                raise hosted_rooms.RoomConflictError('exact unsent edited draft is unavailable')
            conn.execute('INSERT INTO hosted_conversation_draft_cancellations VALUES (?,?,?,?)',
                         (conversation_id,input_id,operation_id,request))
            conn.execute('UPDATE hosted_rooms SET revision=revision+1,updated_at=? WHERE room_id=?',
                         (hosted_rooms._now(None),conversation_id))
