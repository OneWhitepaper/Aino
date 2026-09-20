"""Exact logical-turn stop and authenticated reconnection to live participant generations."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_call

import time
from dataclasses import asdict

from gateway import hosted_rooms, hosted_room_driver as driver
from tui_gateway.conversation_activity import capture_conversation_activity
from tui_gateway.session_conversation_binding import ConversationBindingError

_TERMINAL = frozenset(('settled', 'failed', 'cancelled'))


def _stop_scope(service, conversation_id, turn_id, execution_generation, include_delegations):
    """The client generation CAS and logical-turn fence share one SQLite write transaction."""
    with hosted_rooms._transaction(service.db_path, immediate=True) as conn:
        source = conn.execute('''SELECT * FROM hosted_room_driver_tasks
            WHERE room_id=? AND turn_id=?''', (conversation_id, turn_id)).fetchone()
        if source is None or source['execution_generation'] != execution_generation:
            return None
        frozen = conn.execute('''SELECT i.participant_id,p.session_generation FROM hosted_room_conversation_inputs i
            JOIN hosted_conversation_prepared_inputs p USING(conversation_id,input_id)
            WHERE i.conversation_id=? AND i.turn_id=?''', (conversation_id, turn_id)).fetchone()
        target_ids, origin_ids = {source['task_id']}, []
        coordinates = {(source['task_id'], source['execution_generation'])}
        if include_delegations:
            continuation = conn.execute('''SELECT origin_turn_id FROM hosted_conversation_notifications
                WHERE conversation_id=? AND continuation_turn_id=?''', (conversation_id, turn_id)).fetchone()
            logical_turn = continuation['origin_turn_id'] if continuation else turn_id
            origin_ids = service.notifications._cancel_locked(conn, conversation_id,
                origin_turn_id=logical_turn, participant_id=frozen['participant_id'],
                session_generation=frozen['session_generation'])
            for row in conn.execute('''SELECT t.task_id,t.execution_generation FROM hosted_room_driver_tasks t
                JOIN hosted_room_conversation_inputs i ON i.conversation_id=t.room_id AND i.turn_id=t.turn_id
                JOIN hosted_conversation_prepared_inputs p USING(conversation_id,input_id)
                WHERE t.room_id=? AND i.participant_id=? AND p.session_generation=?
                AND (t.turn_id=? OR t.turn_id IN (SELECT continuation_turn_id
                    FROM hosted_conversation_notifications WHERE conversation_id=? AND origin_turn_id=?
                    AND participant_id=? AND session_generation=?))''',
                (conversation_id, frozen['participant_id'], frozen['session_generation'], logical_turn,
                 conversation_id, logical_turn, frozen['participant_id'], frozen['session_generation'])):
                target_ids.add(row['task_id'])
                coordinates.add((row['task_id'], row['execution_generation']))
            coordinates.update((row['task_id'], row['execution_generation']) for row in conn.execute('''
                SELECT task_id,execution_generation FROM hosted_conversation_background_origins
                WHERE conversation_id=? AND origin_turn_id=? AND participant_id=? AND session_generation=?''',
                (conversation_id, logical_turn, frozen['participant_id'], frozen['session_generation'])))
        tasks = [task for task in service._tasks(conversation_id) if task['identity'].task_id in target_ids]
        return tasks, origin_ids, coordinates


def _cancel_task(service, task, *, logical_turn=False):
    identity = task['identity']
    for _ in range(3):
        current = driver.get_task(service.db_path, identity)
        if not logical_turn and current['execution_generation'] != task['execution_generation']:
            return False
        if current['status'] in _TERMINAL:
            return True
        restored = ((current.get('result') or {}).get('error') == 'restored_snapshot_requires_stop'
                    and current['status'] in ('indeterminate', 'stopping')
                    and all(current.get(key) is None for key in
                            ('run_gateway_id', 'run_process_generation', 'run_lease_generation')))
        try:
            if restored:
                # Offline restore revoked every execution fence. Only this exact
                # restored generation is known not to own a live external turn.
                cancel_id = current.get('cancel_id') or f"restored-stop:{identity.turn_id}:{current['execution_generation']}"
                if current['status'] != 'stopping':
                    current = driver.begin_task_cancel(service.db_path, identity, cancel_id=cancel_id,
                        expected_cancel_generation=current['cancel_generation'],
                        expected_execution_generation=current['execution_generation'], clock=time.time)
                result = driver.complete_task_cancel(service.db_path, identity, cancel_id=cancel_id,
                    expected_cancel_generation=current['cancel_generation'], clock=time.time)
                return result['status'] == 'cancelled'
            if service.hosted is not None:
                result = service.hosted.runtime.cancel(identity,
                    cancel_id=f"conversation-stop:{identity.turn_id}:{current['execution_generation']}",
                    expected_execution_generation=current['execution_generation'])
            else:
                operation = driver.cancel_task if current['status'] in ('queued','deferred') else driver.begin_task_cancel
                result = operation(service.db_path, identity,
                    cancel_id=f"conversation-stop:{identity.turn_id}:{current['execution_generation']}",
                    expected_cancel_generation=current['cancel_generation'],
                    expected_execution_generation=current['execution_generation'], clock=time.time)
            return result['status'] in _TERMINAL
        except (driver.StaleTaskError, driver.InvalidTaskTransitionError):
            # A queued task can start while its accepted stop is being signalled.
            # It remains inside the fenced logical turn, so retry the live generation.
            continue
    return False


def _interrupt_units(unit_ids):
    from tools import async_delegation as registry
    units = set(unit_ids)
    with registry._records_lock:
        targets = [dict(record) for key, record in registry._records.items()
                   if key in units and record.get('status') in registry._ACTIVE_STATES]
    registry._interrupt_records(targets, 'conversation.stop', 'User stopped the originating conversation turn',
                                'Interrupted %d conversation background unit(s) (%s)')
    with registry._records_lock:
        # A stalled record may have been force-finalized while its worker is still alive.
        return not any(key in units and record.get('status') in (*registry._LIVE_STATES, 'stalled')
                       for key, record in registry._records.items())


def _cancel_origin_requests(conversation_id, coordinates):
    from tui_gateway import server_requests
    with server_requests._lock:
        targets = []
        for request in tuple(server_requests._open.values()):
            origin = request.params.get('conversation') or {}
            if (origin.get('conversation_id') == conversation_id
                    and (origin.get('task_id'), origin.get('execution_generation')) in coordinates):
                server_requests._open.pop(request.id)
                targets.append(request)
    for request in targets:
        request.result, request.answered = None, False
        if request.on_result is not None:
            request.on_result(None)
        request.event.set()
        server_requests._emit_cancel(request, 'interrupted')


@managed_call
def stop_conversation(service, conversation_id, turn_id, execution_generation, include_delegations=False):
    with service._lock:
        service.notifications.recover_dead_origins()
        scope = _stop_scope(service, conversation_id, turn_id, execution_generation, include_delegations)
        if scope is None:
            return {'status': 'not_found'}
        tasks, origins, coordinates = scope
    # Signal outside the service lock: completion callbacks may need that same lock to finish.
    units = [identity for identity in origins if not identity.startswith(('process:', 'kanban:'))]
    children_stopped = _interrupt_units(units) if include_delegations else True
    tasks_stopped = all([_cancel_task(service, task, logical_turn=include_delegations) for task in tasks])
    # Interrupt the participant before waking its blocked tool. Otherwise the
    # resumed tool can race Stop into the next model-call generation guard.
    _cancel_origin_requests(conversation_id, coordinates)
    if service.hosted:
        service.hosted.wakeup()
    return {'status': 'confirmed' if tasks_stopped and children_stopped else 'requested'}


def _live_generation(service, conversation_id, participant_id, session_generation):
    with service.server._sessions_lock:
        candidates = tuple(service.server._sessions.items())
    return next(((sid, session) for sid, session in candidates
        if not session.get('_finalized') and not session.get('_closing')
        and (session.get('_conversation_binding') or {}).get('conversation_id') == conversation_id
        and session['_conversation_binding'].get('participant_id') == participant_id
        and session['_conversation_binding'].get('session_generation') == session_generation), None)


def _background_activities(service, conversation_id, participant_id, generation, sid):
    from tools import async_delegation as registry
    with registry._records_lock:
        live = {key for key, record in registry._records.items() if record.get('status') in registry._LIVE_STATES}
    with hosted_rooms._transaction(service.db_path) as conn:
        rows = conn.execute('''SELECT o.delegation_id,o.task_id,t.turn_id,o.execution_generation
            FROM hosted_conversation_background_origins o JOIN hosted_room_driver_tasks t
                ON t.room_id=o.conversation_id AND t.task_id=o.task_id
            WHERE o.conversation_id=? AND o.participant_id=? AND o.session_generation=?''',
            (conversation_id, participant_id, generation)).fetchall()
    coordinates = {(row['task_id'], row['turn_id'], row['execution_generation'])
                   for row in rows if row['delegation_id'] in live}
    return [{'conversation_id': conversation_id, 'participant_id': participant_id, 'session_generation': generation,
             'runtime_id': sid, 'task_id': task_id, 'turn_id': turn_id, 'execution_generation': execution}
            for task_id, turn_id, execution in sorted(coordinates)]


def runtime_snapshot(service, conversation_id, participant_id, session_generation):
    binding = next((binding for binding in service.store.participants(conversation_id)
                    if binding.participant.participant_id == participant_id), None)
    if binding is None or binding.session_generation != session_generation:
        raise ConversationBindingError('participant generation changed')
    from gateway.hosted_room_conversation_bindings import ConversationBindings
    model_snapshot = ConversationBindings(service.db_path).public_model_snapshot(
        conversation_id, participant_id, session_generation, include_prepared=True)
    result = {'model_snapshot': model_snapshot, 'available': False, 'runtime_id': None, 'subagents': [], 'open_requests': [],
              'activity': None, 'background_activities': []}
    live = _live_generation(service, conversation_id, participant_id, session_generation)
    if live is None:
        service.notifications.recover_dead_origins()
        return result
    sid, session = live
    # Activate is the existing authenticated live-session reattachment path. Unlike resume,
    # it cannot create a runtime or revive process-local background work.
    activated = service.server._methods['session.activate']('conversation-snapshot',
        {'session_id': sid, 'omit_messages': True})
    if activated.get('error'):
        raise ConversationBindingError(activated['error']['message'])
    snapshot = service.server._methods['subagent.list']('conversation-snapshot', {'session_id': sid})
    if snapshot.get('error'):
        raise ConversationBindingError(snapshot['error']['message'])
    from tui_gateway import server_requests
    with session['history_lock']:
        activity = capture_conversation_activity(sid, session) if session.get('running') else None
    return {**result, 'available': True, 'runtime_id': sid,
        'subagents': snapshot['result']['subagents'], 'open_requests': server_requests.open_requests(sid),
        'activity': asdict(activity) if activity else None,
        'background_activities': _background_activities(service, conversation_id, participant_id, session_generation, sid)}
