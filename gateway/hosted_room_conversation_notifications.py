"""Durable background origins and FIFO continuation admission in the Hosted database."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_store

import hashlib
import json
import os
import time

from gateway import hosted_rooms, hosted_room_driver as driver
from gateway.hosted_room_conversation_types import TurnSubmission


@managed_store
class ConversationNotifications:
    def __init__(self, store):
        self.store, self.db_path = store, store.db_path
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_background_origins (
                delegation_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
                participant_id TEXT NOT NULL, session_generation INTEGER NOT NULL,
                origin_turn_id TEXT NOT NULL, task_id TEXT NOT NULL, thread_id TEXT NOT NULL,
                execution_generation INTEGER NOT NULL, owner_pid INTEGER NOT NULL,
                owner_started REAL NOT NULL, state TEXT NOT NULL,
                FOREIGN KEY(conversation_id,participant_id) REFERENCES
                    hosted_room_conversation_participants(conversation_id,participant_id))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_background_fences (
                conversation_id TEXT NOT NULL, origin_turn_id TEXT NOT NULL,
                participant_id TEXT NOT NULL, session_generation INTEGER NOT NULL, state TEXT NOT NULL,
                PRIMARY KEY(conversation_id,origin_turn_id,participant_id,session_generation))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_notifications (
                conversation_id TEXT NOT NULL, notification_id TEXT NOT NULL,
                participant_id TEXT NOT NULL, session_generation INTEGER NOT NULL,
                origin_turn_id TEXT NOT NULL, source_turn_id TEXT NOT NULL,
                delegation_id TEXT, text TEXT NOT NULL, seq INTEGER NOT NULL,
                state TEXT NOT NULL, continuation_turn_id TEXT NOT NULL,
                PRIMARY KEY(conversation_id,notification_id))''')

    def capture(self, metadata, attempt, delegation_id):
        import psutil
        identity = attempt.identity
        if identity.room_id != metadata['conversation_id']:
            raise hosted_rooms.RoomConflictError('background origin belongs to another conversation')
        task = driver.get_task(self.db_path, identity)
        frozen = self.store.input_for_task(task)
        if (task['execution_generation'] != attempt.execution_generation
                or frozen['participant_id'] != metadata['participant_id']
                or frozen['session_generation'] != metadata['session_generation']):
            raise hosted_rooms.RoomConflictError('background origin generation changed')
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            current = conn.execute('SELECT status,execution_generation FROM hosted_room_driver_tasks WHERE room_id=? AND task_id=?',
                                   (identity.room_id, identity.task_id)).fetchone()
            if current is None or current['status'] not in ('running', 'settled', 'failed') or current['execution_generation'] != attempt.execution_generation:
                raise hosted_rooms.RoomConflictError('background origin is no longer continuable')
            prior = conn.execute('''SELECT origin_turn_id FROM hosted_conversation_notifications
                WHERE conversation_id=? AND continuation_turn_id=?''',
                (identity.room_id, identity.turn_id)).fetchone()
            origin_turn = prior['origin_turn_id'] if prior else identity.turn_id
            if self._fenced(conn, metadata, origin_turn):
                raise hosted_rooms.RoomConflictError('background origin was explicitly stopped')
            conn.execute('''INSERT OR IGNORE INTO hosted_conversation_background_origins VALUES
                (?,?,?,?,?,?,?,?,?,?,?)''', (delegation_id, identity.room_id,
                metadata['participant_id'], metadata['session_generation'],
                origin_turn, identity.task_id,
                identity.thread_id, attempt.execution_generation, os.getpid(),
                psutil.Process().create_time(), 'pending'))

    @staticmethod
    def _fenced(conn, metadata, origin_turn_id):
        return conn.execute("""SELECT 1 FROM hosted_conversation_background_fences
            WHERE conversation_id=? AND origin_turn_id IN ('',?) AND participant_id IN ('',?)
            AND session_generation IN (0,?) LIMIT 1""", (metadata['conversation_id'], origin_turn_id,
                metadata['participant_id'], metadata['session_generation'])).fetchone() is not None

    def dispatch_allowed(self, delegation_id):
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute("""SELECT 1 FROM hosted_conversation_background_origins o
                JOIN hosted_room_driver_tasks t ON t.room_id=o.conversation_id AND t.task_id=o.task_id
                JOIN hosted_room_conversation_participants p ON p.conversation_id=o.conversation_id
                    AND p.participant_id=o.participant_id
                WHERE o.delegation_id=? AND o.state='pending' AND t.status NOT IN ('stopping','cancelled')
                    AND t.execution_generation=o.execution_generation AND p.session_generation=o.session_generation""",
                (delegation_id,)).fetchone()
            return row is not None

    def rejected(self, delegation_id):
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            conn.execute("UPDATE hosted_conversation_background_origins SET state='rejected' WHERE delegation_id=?",
                         (delegation_id,))

    def origin(self, delegation_id):
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute('SELECT * FROM hosted_conversation_background_origins WHERE delegation_id=?',
                               (delegation_id,)).fetchone()
            return dict(row) if row else None

    def delegations(self, conversation_id):
        """Public lifecycle metadata; process origins and private result text stay internal."""
        with hosted_rooms._transaction(self.db_path) as conn:
            return [dict(row) for row in conn.execute("""SELECT delegation_id,origin_turn_id,
                participant_id,session_generation,state AS status FROM hosted_conversation_background_origins
                WHERE conversation_id=? AND delegation_id NOT LIKE 'process:%'
                AND delegation_id NOT LIKE 'kanban:%' AND state NOT IN ('rejected','completed','cancelled')
                ORDER BY delegation_id""", (conversation_id,))]

    def pending(self, conversation_id):
        with hosted_rooms._transaction(self.db_path) as conn:
            return tuple(dict(row) for row in conn.execute('''SELECT * FROM hosted_conversation_notifications
                WHERE conversation_id=? AND state='queued' ORDER BY seq''', (conversation_id,)))

    def has_pending(self, metadata):
        with hosted_rooms._transaction(self.db_path) as conn:
            args = (metadata['conversation_id'], metadata['participant_id'], metadata['session_generation'])
            return bool(conn.execute('''SELECT 1 FROM hosted_conversation_background_origins
                WHERE conversation_id=? AND participant_id=? AND session_generation=? AND state='pending'
                UNION ALL SELECT 1 FROM hosted_conversation_notifications WHERE conversation_id=?
                AND participant_id=? AND session_generation=? AND state='queued' LIMIT 1''', args + args).fetchone())

    def enqueue(self, metadata, *, origin_turn_id, source_turn_id, notification_id, text, delegation_id=None, terminal=True):
        conversation_id = metadata['conversation_id']
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            old = conn.execute('''SELECT * FROM hosted_conversation_notifications
                WHERE conversation_id=? AND notification_id=?''', (conversation_id, notification_id)).fetchone()
            if old:
                if (old['participant_id'], old['session_generation'], old['text']) != (
                        metadata['participant_id'], metadata['session_generation'], text):
                    raise hosted_rooms.RoomConflictError('notification identity was reused with different content')
                return dict(old)
            record = self.store._get_locked(conn, conversation_id)
            participant = conn.execute('''SELECT * FROM hosted_room_conversation_participants
                WHERE conversation_id=? AND participant_id=?''',
                (conversation_id, metadata['participant_id'])).fetchone()
            origin = conn.execute('SELECT * FROM hosted_conversation_background_origins WHERE delegation_id=?',
                                  (delegation_id,)).fetchone() if delegation_id else None
            task = conn.execute('''SELECT status,execution_generation FROM hosted_room_driver_tasks WHERE room_id=? AND turn_id=?''',
                                (conversation_id, source_turn_id)).fetchone()
            fenced = (self._fenced(conn, metadata, origin_turn_id) or record.archived or participant is None
                or participant['session_generation'] != metadata['session_generation']
                or (delegation_id and (origin is None or origin['state'] in ('cancelled','interrupted','rejected')))
                or (task and task['status'] in ('stopping','cancelled'))
                or (origin and task and task['execution_generation'] != origin['execution_generation']))
            state = 'cancelled' if fenced else 'queued'
            digest = hashlib.sha256(notification_id.encode()).hexdigest()
            actor = {'kind': 'participant', 'id': metadata['participant_id'],
                     'display_name': participant['display_name'] if participant else metadata['participant_id']}
            normalized, actor_json = hosted_rooms._validate_actor(actor, kind='conversation.notification')
            room = conn.execute('SELECT * FROM hosted_rooms WHERE room_id=?', (conversation_id,)).fetchone()
            event = hosted_rooms._append_event_locked(conn, room_id=conversation_id, purpose='conversation',
                event_id='conversation-notification:' + digest, kind='conversation.notification',
                normalized_actor=normalized, actor_json=actor_json,
                payload_json=hosted_rooms._payload_json({'notification_id': notification_id,
                    'origin_turn_id': origin_turn_id, 'participant_id': metadata['participant_id'],
                    'session_generation': metadata['session_generation'], 'delegation_id': delegation_id,
                    'status': state, 'text': 'Background result ready' if not fenced else 'Background result cancelled',
                    'author_display_name_at_time': actor['display_name']}),
                authority_gateway_id=room['authority_gateway_id'], authority_epoch=room['authority_epoch'],
                now=time.time())
            conn.execute('INSERT INTO hosted_conversation_notifications VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (conversation_id, notification_id, metadata['participant_id'], metadata['session_generation'],
                 origin_turn_id, source_turn_id, delegation_id, text, event['seq'], state, 'continuation:' + digest))
            if delegation_id and terminal:
                conn.execute("UPDATE hosted_conversation_background_origins SET state=? WHERE delegation_id=? AND state='pending'",
                             ('cancelled' if fenced else 'completed', delegation_id))
            # New user admissions prepared before this event must retry behind the durable queue.
            conn.execute('UPDATE hosted_rooms SET revision=revision+1 WHERE room_id=?', (conversation_id,))
            return dict(conn.execute('''SELECT * FROM hosted_conversation_notifications
                WHERE conversation_id=? AND notification_id=?''', (conversation_id, notification_id)).fetchone())

    def admit_continuation(self, notification, binding, envelope, *, expected_revision, input_cutoff):
        from .hosted_room_conversation_compat import require_compatible_backends
        require_compatible_backends(self.db_path)
        from gateway.hosted_room_conversation import plan_conversation_turn
        from gateway.hosted_room_conversation_admission import ConversationBusyError
        request = continuation_submission(notification)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            current = conn.execute('''SELECT * FROM hosted_conversation_notifications WHERE
                conversation_id=? AND notification_id=?''',
                (binding.conversation_id, notification['notification_id'])).fetchone()
            if current['state'] == 'admitted':
                return self.store._replay_locked(conn, binding.conversation_id, request)
            first = conn.execute('''SELECT notification_id FROM hosted_conversation_notifications WHERE
                conversation_id=? AND state='queued' ORDER BY seq LIMIT 1''', (binding.conversation_id,)).fetchone()
            if current['state'] != 'queued' or first is None or first[0] != notification['notification_id']:
                raise ConversationBusyError('continuation is not the next queued notification')
            source = conn.execute('SELECT status FROM hosted_room_driver_tasks WHERE room_id=? AND turn_id=?',
                                  (binding.conversation_id, current['source_turn_id'])).fetchone()
            if source is None or source['status'] in ('cancelled', 'stopping'):
                raise ConversationBusyError('continuation source was cancelled')
            record = self.store._check_admission_locked(conn, binding.conversation_id, expected_revision,
                continuation_notification_id=current['notification_id'])
            generation = conn.execute('''SELECT session_generation,lineage_id FROM
                hosted_room_conversation_participants WHERE conversation_id=? AND participant_id=?''',
                (binding.conversation_id, binding.participant.participant_id)).fetchone()
            cutoff = conn.execute('SELECT next_seq-1 FROM hosted_rooms WHERE room_id=?', (binding.conversation_id,)).fetchone()[0]
            if tuple(generation) != (binding.session_generation, binding.lineage_id) or cutoff != input_cutoff:
                raise hosted_rooms.RoomConflictError('continuation context changed')
            from .hosted_room_conversation_budget import reserve_output
            reserve_output(conn, binding.conversation_id, request.input_id)
            admission = self._append_continuation_locked(conn, binding, request, current)
            self.store._prepare_input_locked(conn, binding, request.input_id, envelope)
            plan = plan_conversation_turn(record, binding, request, admission, envelope)
            driver._admit_task_locked(conn, plan.identity, payload=plan.payload, clock=time.time)
            conn.execute("UPDATE hosted_conversation_notifications SET state='admitted' WHERE conversation_id=? AND notification_id=?",
                         (binding.conversation_id, current['notification_id']))
            return admission

    def _append_continuation_locked(self, conn, binding, request, notification):
        from gateway.hosted_room_conversation_types import Admission
        event_id = 'conversation-continuation:' + hashlib.sha256(request.input_id.encode()).hexdigest()
        actor = {'kind': 'participant', 'id': binding.participant.participant_id,
                 'display_name': binding.participant.display_name}
        normalized, actor_json = hosted_rooms._validate_actor(actor, kind='conversation.continuation')
        payload = {'turn_id': request.turn_id, 'input_id': request.input_id, 'text': request.text,
            'attachment_ids': [], 'target_participant_id': binding.participant.participant_id,
            'target_display_name_at_time': binding.participant.display_name,
            'author_display_name_at_time': binding.participant.display_name,
            'origin_turn_id': notification['origin_turn_id'], 'notification_id': notification['notification_id'],
            'delegation_id': notification['delegation_id'], 'session_generation': binding.session_generation}
        room = conn.execute('SELECT * FROM hosted_rooms WHERE room_id=?', (binding.conversation_id,)).fetchone()
        event = hosted_rooms._append_event_locked(conn, room_id=binding.conversation_id, purpose='conversation',
            event_id=event_id, kind='conversation.continuation', normalized_actor=normalized, actor_json=actor_json,
            payload_json=hosted_rooms._payload_json(payload), authority_gateway_id=room['authority_gateway_id'],
            authority_epoch=room['authority_epoch'], now=time.time())
        conn.execute("""INSERT INTO hosted_room_conversation_inputs(
            conversation_id,turn_id,input_id,event_id,participant_id,text,attachment_ids_json,
            author_id,author_display_name,target_display_name,seq) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (binding.conversation_id, request.turn_id, request.input_id, event_id,
             binding.participant.participant_id, request.text, '[]', binding.participant.participant_id,
             binding.participant.display_name, binding.participant.display_name, event['seq']))
        return Admission(binding.conversation_id, request.turn_id, request.input_id, event_id,
                         event['seq'], binding.participant.participant_id, False)

    def cancel(self, conversation_id, *, origin_turn_id=None, participant_id=None, session_generation=None,
               state='cancelled'):
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            return self._cancel_locked(conn, conversation_id, origin_turn_id=origin_turn_id,
                participant_id=participant_id, session_generation=session_generation, state=state)

    def _cancel_locked(self, conn, conversation_id, *, origin_turn_id=None, participant_id=None,
                       session_generation=None, state='cancelled'):
        clauses, values = ['conversation_id=?'], [conversation_id]
        for key, value in (('origin_turn_id', origin_turn_id), ('participant_id', participant_id),
                           ('session_generation', session_generation)):
            if value is not None:
                clauses.append(key + '=?')
                values.append(value)
        where = ' AND '.join(clauses)
        if origin_turn_id is not None:
            scopes = [(conversation_id, origin_turn_id, participant_id or '', session_generation or 0)]
        else:
            scopes = [tuple(row) for row in conn.execute(
                'SELECT DISTINCT conversation_id,origin_turn_id,participant_id,session_generation '
                'FROM hosted_conversation_background_origins WHERE ' + where +
                ' UNION SELECT conversation_id,origin_turn_id,participant_id,session_generation '
                'FROM hosted_conversation_notifications WHERE ' + where, values + values)]
        conn.executemany('INSERT OR REPLACE INTO hosted_conversation_background_fences VALUES (?,?,?,?,?)',
                         [(*scope, state) for scope in scopes])
        ids = [row[0] for row in conn.execute('SELECT delegation_id FROM hosted_conversation_background_origins WHERE ' + where,
                                            values)]
        conn.execute("UPDATE hosted_conversation_background_origins SET state=? WHERE " + where, [state, *values])
        conn.execute("UPDATE hosted_conversation_notifications SET state=? WHERE " + where + " AND state='queued'", [state, *values])
        return ids

    def recover_dead_origins(self):
        import psutil
        with hosted_rooms._transaction(self.db_path) as conn:
            owners = conn.execute("SELECT DISTINCT owner_pid,owner_started FROM hosted_conversation_background_origins WHERE state='pending'").fetchall()
        for pid, started in owners:
            try:
                alive = psutil.Process(pid).create_time() == started
            except psutil.NoSuchProcess:
                alive = False
            if not alive:
                with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
                    conn.execute("UPDATE hosted_conversation_background_origins SET state='interrupted' WHERE owner_pid=? AND owner_started=? AND state='pending'", (pid, started))


def continuation_submission(notification):
    return TurnSubmission(notification['continuation_turn_id'], notification['continuation_turn_id'],
                          notification['participant_id'], notification['text'], ())
