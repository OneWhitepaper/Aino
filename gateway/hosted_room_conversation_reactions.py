"""Event-owned reaction metadata, independent of public history and runtime context."""
import json
import time
import unicodedata

from gateway import hosted_rooms
from gateway.hosted_room_conversation_history import _encoded, _event
from gateway.hosted_room_conversation_maintenance import managed_store
from gateway.hosted_room_conversation_owners import require_owner_locked


@managed_store
class ConversationReactions:
    def __init__(self, db_path):
        self.db_path = db_path
        with hosted_rooms._transaction(db_path, immediate=True) as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_reactions (
                conversation_id TEXT NOT NULL,event_id TEXT NOT NULL,owner_key TEXT NOT NULL,
                revision INTEGER NOT NULL,emoji TEXT,at REAL NOT NULL,
                PRIMARY KEY(conversation_id,event_id,owner_key))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_reaction_operations (
                owner_key TEXT NOT NULL,operation_id TEXT NOT NULL,request_json TEXT NOT NULL,
                result_json TEXT NOT NULL,PRIMARY KEY(owner_key,operation_id))''')

    def _state(self, conn, conversation_id, event_id, owner_key):
        row = conn.execute('SELECT * FROM hosted_conversation_reactions WHERE conversation_id=? AND event_id=? AND owner_key=?',
                           (conversation_id,event_id,owner_key)).fetchone()
        return {'event_id': event_id, 'revision': row['revision'] if row else 0,
                'reactions': [{'emoji':row['emoji'],'author':'user','at':row['at']}] if row and row['emoji'] else []}

    def read(self, *, owner_key, conversation_id, event_ids):
        if len(event_ids) > 200:
            raise ValueError('too many event identities')
        with hosted_rooms._transaction(self.db_path) as conn:
            require_owner_locked(conn,conversation_id,owner_key)
            for event_id in event_ids:
                _event(conn,conversation_id,event_id)
            return [self._state(conn,conversation_id,event_id,owner_key) for event_id in event_ids]

    def set(self, *, owner_key, conversation_id, event_id, operation_id, emoji, expected_reaction_revision):
        operation_id = hosted_rooms._event_id(operation_id)
        if emoji is not None and (not emoji.strip() or len(emoji)>32 or any(unicodedata.category(c) == 'Cc' for c in emoji)):
            raise ValueError('invalid reaction')
        request = _encoded(dict(conversation_id=conversation_id,event_id=event_id,emoji=emoji,
                               expected_reaction_revision=expected_reaction_revision))
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            require_owner_locked(conn,conversation_id,owner_key)
            _event(conn,conversation_id,event_id)
            old = conn.execute('SELECT * FROM hosted_conversation_reaction_operations WHERE owner_key=? AND operation_id=?',
                               (owner_key,operation_id)).fetchone()
            if old:
                if old['request_json'] != request:
                    raise hosted_rooms.RoomConflictError('reaction operation identity changed')
                return json.loads(old['result_json'])
            state = self._state(conn,conversation_id,event_id,owner_key)
            if state['revision'] != expected_reaction_revision:
                raise hosted_rooms.RoomConflictError('reaction revision changed')
            conn.execute('INSERT OR REPLACE INTO hosted_conversation_reactions VALUES (?,?,?,?,?,?)',
                         (conversation_id,event_id,owner_key,state['revision']+1,emoji,time.time()))
            result = self._state(conn,conversation_id,event_id,owner_key)
            conn.execute('INSERT INTO hosted_conversation_reaction_operations VALUES (?,?,?,?)',
                         (owner_key,operation_id,request,_encoded(result)))
            return result
