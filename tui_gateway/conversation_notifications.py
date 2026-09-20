"""Route managed background wakes through the same Hosted scheduler as user turns."""
from __future__ import annotations

import hashlib
import json

from gateway import hosted_rooms, hosted_room_driver as driver
from gateway.hosted_room_conversation_admission import UNRESOLVED
from gateway.hosted_room_conversation_notifications import continuation_submission
from gateway.hosted_room_conversation_summaries import prepare_turn_envelope
from tui_gateway.session_conversation_binding import ConversationBindingError


def _service():
    from tui_gateway import server
    return server.get_conversation_service()


def capture_conversation_delegation(session: dict, delegation_id: str) -> None:
    if not session or not (metadata := session.get('_conversation_binding')):
        return
    service = _service()
    with service._lock:
        from .conversation_activity import current_conversation_attempt
        attempt = current_conversation_attempt()
        if not isinstance(attempt, driver.TaskAttempt):
            raise ConversationBindingError('background task has no originating conversation turn')
        service.notifications.capture(metadata, attempt, delegation_id)


def conversation_delegation_dispatch_allowed(session, delegation_id):
    if not isinstance(session, dict) or not session.get('_conversation_binding'):
        return True
    return _service().notifications.dispatch_allowed(delegation_id)


def reject_conversation_delegation(session: dict, delegation_id: str) -> None:
    if session and session.get('_conversation_binding'):
        service = _service()
        with service._lock:
            service.notifications.rejected(delegation_id)


def capture_conversation_tool_result(session, name, result, args=None):
    if not session or not session.get('_conversation_binding') or not isinstance(result, dict):
        return
    if name == 'kanban_create' and result.get('subscribed') and result.get('task_id'):
        from hermes_cli.kanban_db import kanban_db_path
        resource = f"kanban:{kanban_db_path((args or {}).get('board')).resolve()}:{result['task_id']}"
        capture_conversation_delegation(session, resource)
    if name == 'terminal' and (process_id := result.get('session_id') or result.get('yielded_session_id')):
        from tools.process_registry import process_registry
        process = process_registry.get(process_id)
        if process and (process.notify_on_complete or process.watch_patterns):
            capture_conversation_delegation(session, 'process:' + str(process_id))


def _notification_id(event):
    if event.get('event_id'):
        return str(event['event_id'])
    from tui_gateway import server
    identity = server._notification_event_dedup_key(event)
    return 'notification:' + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def route_conversation_notification(sid: str, session: dict, event: dict, text: str) -> bool:
    """False only for unmanaged sessions. Failure propagates so the caller can retry admission."""
    if not (metadata := session.get('_conversation_binding')):
        return False
    from tools.async_delegation import claim_event_delivery, complete_event_delivery, defer_completion_delivery
    claim = claim_event_delivery(event, 'conversation-notification')
    if claim is None:
        return True
    try:
        service = _service()
        with service._lock:
            notifications = service.notifications
            delegation_id = event.get('origin_id') or (str(event['delegation_id']) if event.get('type') == 'async_delegation'
                             else 'process:' + str(event['session_id']) if event.get('session_id') else None)
            origin = notifications.origin(delegation_id) if delegation_id else None
            if delegation_id and origin is None:
                # A fast process/kanban completion may beat its tool-complete callback.
                # Retry until that callback saves the origin; never guess from a later turn.
                raise ConversationBindingError('background event has no durable conversation origin')
            if origin:
                if (origin['conversation_id'], origin['participant_id'], origin['session_generation']) != (
                        metadata['conversation_id'], metadata['participant_id'], metadata['session_generation']):
                    raise ConversationBindingError('background event belongs to another participant generation')
                task = next(t for t in service._tasks(origin['conversation_id'])
                            if t['identity'].task_id == origin['task_id'])
                origin_turn, source_turn = origin['origin_turn_id'], task['identity'].turn_id
            else:
                attempt = session.get('_conversation_attempt')
                if not isinstance(attempt, driver.TaskAttempt):
                    raise ConversationBindingError('notification has no originating conversation turn')
                origin_turn = source_turn = attempt.identity.turn_id
            notifications.enqueue(metadata, origin_turn_id=origin_turn, source_turn_id=source_turn,
                notification_id=_notification_id(event), text=text, delegation_id=delegation_id,
                terminal=event.get('terminal', not event.get('task_failure_notice') and event.get('type', 'completion') in ('completion','async_delegation')))
        complete_event_delivery(event, claim)
        if service.hosted:
            service.hosted.wakeup()
    except Exception:
        if claim and event.get('type') == 'async_delegation':
            defer_completion_delivery(str(event['delegation_id']), claim)
        raise
    return True


def drain_conversation_notifications(service, room_binding) -> bool:
    """Admit at most one queued wake at an idle boundary, using its original live owner."""
    from .conversation_service import _Preparation
    from .conversation_transport import ConversationTransport
    with service._lock:
        notifications = service.notifications
        notifications.recover_dead_origins()
        tasks = service._tasks(room_binding.room_id)
        if any(task['status'] in UNRESOLVED for task in tasks):
            return False
        pending = notifications.pending(room_binding.room_id)
        if not pending:
            return False
        notification = pending[0]
        binding = next(b for b in service.store.participants(room_binding.room_id)
                       if b.participant.participant_id == notification['participant_id'])
        source = next(t for t in tasks if t['identity'].turn_id == notification['source_turn_id'])
        if (binding.session_generation != notification['session_generation']
                or source['status'] in ('cancelled','stopping')
                or service.store.get(room_binding.room_id).archived):
            notifications.cancel(room_binding.room_id, origin_turn_id=notification['origin_turn_id'],
                                 participant_id=notification['participant_id'], session_generation=notification['session_generation'])
            return False
        transport = ConversationTransport(service, source)
        try:
            with transport._owner() as (_sid, session, _metadata):
                if session.get('running') or session.get('_finalized'):
                    return False
                request = continuation_submission(notification)
                room = hosted_rooms.room_state(service.db_path, room_id=room_binding.room_id, purpose='conversation')
                preparation = _Preparation(service.store, service.store.get(room_binding.room_id).revision)
                with service.server._profile_build_scope(service.server._profile_home(binding.participant.profile)):
                    envelope = prepare_turn_envelope(preparation, binding=binding, request=request,
                        input_cutoff=room['latest_seq'], budget_bytes=48 * 1024,
                        main_runtime=session['agent']._current_main_runtime())
                notifications.admit_continuation(notification, binding, envelope,
                    expected_revision=preparation.revision, input_cutoff=room['latest_seq'])
        except ConversationBindingError:
            # Reconnection restores the exact owner; background work never invents transport authority.
            return False
        return True


def conversation_has_pending_background(session):
    if not (metadata := session.get('_conversation_binding')):
        return False
    return _service().notifications.has_pending(metadata)


def finalize_conversation_background(session):
    if metadata := session.get('_conversation_binding'):
        _service().notifications.cancel(metadata['conversation_id'],
            participant_id=metadata['participant_id'], session_generation=metadata['session_generation'], state='interrupted')


def conversation_loop_completion_allowed(session, loop_state):
    """A queued loop tick belongs to its own continuation, never an earlier foreground reply."""
    if not (metadata := session.get('_conversation_binding')):
        return True
    from .conversation_activity import current_conversation_attempt
    attempt = current_conversation_attempt()
    if attempt is None or attempt.identity.room_id != metadata['conversation_id']:
        return False
    with hosted_rooms._transaction(_service().db_path) as conn:
        row = conn.execute("""SELECT notification_id FROM hosted_conversation_notifications
            WHERE conversation_id=? AND continuation_turn_id=? AND participant_id=?
            AND session_generation=? AND state='admitted'""", (metadata['conversation_id'],
            attempt.identity.turn_id, metadata['participant_id'], metadata['session_generation'])).fetchone()
    suffix = f":{loop_state.created_at}:{loop_state.ticks_fired}"
    return bool(row and row[0].startswith('loop:') and row[0].endswith(suffix))


def update_conversation_resource_state(session, origin_id, *, pending):
    service = _service()
    metadata = session['_conversation_binding']
    with service._lock:
        origin = service.notifications.origin(origin_id)
        if origin is None:
            raise ConversationBindingError('background resource origin is not yet durable')
        if (origin['conversation_id'], origin['participant_id'], origin['session_generation']) != (
                metadata['conversation_id'], metadata['participant_id'], metadata['session_generation']):
            raise ConversationBindingError('background resource belongs to another participant')
        with hosted_rooms._transaction(service.db_path, immediate=True) as conn:
            conn.execute("""UPDATE hosted_conversation_background_origins SET state=?
                WHERE delegation_id=? AND state IN ('pending','completed')""",
                ('pending' if pending else 'completed', origin_id))
