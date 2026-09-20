"""Strict, generated conversation RPCs; Profile paths and driver proofs remain internal."""
from __future__ import annotations

from gateway.hosted_room_conversation_admission import ConversationBusyError
from gateway import hosted_rooms, hosted_room_driver
from gateway.hosted_room_conversation_context import ContextBudgetError
from tui_gateway.session_conversation_binding import ConversationBindingError
from tui_gateway.conversation_projects import set_conversation_project
from tui_gateway.conversation_migration import adopt_conversation
from tui_gateway.conversation_export import export_conversation

from tui_gateway.conversation_history import branch, regenerate, react, reactions, cancel_draft

_METHODS = ('export', 'cancel_draft', 'branch', 'regenerate', 'react', 'reactions', 'archive', 'rename', 'adopt', 'capabilities', 'participants', 'create', 'list', 'get', 'send', 'events', 'stop', 'retry', 'refresh', 'prepare', 'runtime_snapshot', 'attach', 'content', 'set_project')
_COORDINATORS = {'export': export_conversation, 'cancel_draft': cancel_draft, 'branch': branch, 'regenerate': regenerate, 'react': react, 'reactions': reactions, 'set_project': set_conversation_project, 'adopt': adopt_conversation}


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
                coordinator = _COORDINATORS.get(suffix)
                result = coordinator(service, **params) if coordinator else getattr(service, suffix)(**params)
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
