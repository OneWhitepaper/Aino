"""A project change is an explicit whole-conversation generation boundary."""

from gateway.hosted_room_conversation_maintenance import managed_call
from gateway.hosted_room_conversation_projects import change_conversation_project
from tui_gateway.session_conversation_binding import _cwd


@managed_call
def set_conversation_project(service, conversation_id, project_ref, expected_revision):
    with service._lock:
        owner = service._authorize(conversation_id, write=True)
        project = service._project(project_ref)
        _cwd(service.store, conversation_id, project)
        return change_conversation_project(service.store, conversation_id, project,
                                           expected_revision=expected_revision, owner_key=owner)
