"""Strict, generated conversation RPCs; Profile paths and driver proofs remain internal."""
from __future__ import annotations

from gateway.hosted_room_conversation_admission import ConversationBusyError
from gateway import hosted_rooms, hosted_room_driver
from gateway.hosted_room_conversation_context import ContextBudgetError
from tui_gateway.session_conversation_binding import ConversationBindingError

_METHODS = ('capabilities', 'participants', 'create', 'list', 'get', 'send', 'events', 'stop', 'retry', 'refresh', 'prepare', 'runtime_snapshot', 'attach', 'content')


def get_conversation_service(server):
    hosted = server.get_hosted_room_service()
    if hosted is not None:
        return hosted.conversations
    # Read-only/administrative RPCs still work before the lifecycle starts the worker.
    from gateway.hosted_rooms import default_db_path
    from .conversation_service import ConversationService
    path = getattr(server, '_conversation_db_path', None) or default_db_path()
    service = getattr(server, '_conversation_service', None)
    if service is None or service.db_path != path:
        service = ConversationService(server, db_path=path)
        server._conversation_service = service
    return service


def _handler(server, suffix):
    def handle(rid, params):
        from pydantic import ValidationError
        from tui_gateway.contracts.registry import METHODS, check_result
        contract = METHODS['conversations.' + suffix]
        try:
            params = contract.params.model_validate(params, strict=True).model_dump(mode='json')
        except ValidationError as exc:
            return server._err(rid, 4000, str(exc))
        try:
            service = server.get_conversation_service()
            if suffix == 'participants':
                result = {'participants': service.catalog()}
            else:
                result = getattr(service, suffix)(**params)
            check_result(contract, result)
            return server._ok(rid, result)
        except ConversationBusyError as exc:
            return server._err(rid, 4121, str(exc), data={'reason': 'busy'})
        except (ConversationBindingError, hosted_rooms.HostedRoomError,
                hosted_room_driver.DriverStateError, ContextBudgetError, ValueError) as exc:
            return server._err(rid, 4120, str(exc), data={'reason': str(exc)})
    return handle


def register(server):
    server.get_conversation_service = lambda: get_conversation_service(server)
    for suffix in _METHODS:
        server.register_method('conversations.' + suffix, _handler(server, suffix))
    server._LONG_HANDLERS |= frozenset('conversations.' + suffix for suffix in _METHODS)
