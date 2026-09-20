"""Private command notices for the exact selected conversation participant."""
from __future__ import annotations

from gateway import hosted_rooms
from tui_gateway.session_conversation_binding import ConversationBindingError

_READ_FORMATTERS = {
    'usage': '_format_live_usage_output',
    'status': '_format_live_status_output',
    'history': '_format_live_history_output',
    'prompt': '_format_live_prompt_output',
    'context': '_format_live_context_output',
    'tools': '_format_live_tools_output',
}
_REFRESH_COMMANDS = frozenset(('model', 'models', 'personality', 'profile', 'profiles',
    'tools', 'toolsets', 'prompt', 'reasoning', 'effort', 'fast', 'new', 'reset', 'cwd'))


class ConversationCommandError(ConversationBindingError):
    def __init__(self, message, reason):
        super().__init__(message)
        self.reason = reason


def read_command_output(server, sid, session, name, arg):
    """Never dispatch through a worker/plugin or a mixed read/mutation helper."""
    if arg.strip():
        return None
    if name == 'model':
        return server._format_live_model_output(session)
    if name == 'help':
        commands = sorted((*_READ_FORMATTERS, 'model', 'help'))
        return ('Private participant commands: ' + ', '.join('/' + name for name in commands)
                + '\nUse the participant refresh action to change its configuration for a new generation.')
    formatter = _READ_FORMATTERS.get(name)
    return getattr(server, formatter)(sid, session, '') if formatter else None


def _expand_selected_command(server, sid, session, name, arg):
    from agent import skill_commands, skill_bundles
    from hermes_cli.commands import resolve_command
    from tools.terminal_scope import (enforce_no_refusal, get_terminal_scope,
                                      set_terminal_scope, reset_terminal_scope)
    if resolve_command(name) is not None:
        return None
    with server._session_profile_runtime_scope(session):
        enforce_no_refusal()
        terminal_token = set_terminal_scope({**(get_terminal_scope() or {}), 'TERMINAL_CWD': session['cwd']})
        tokens = server._set_session_context(session['session_key'], cwd=session['cwd'], ui_session_id=sid)
        try:
            bundles = skill_bundles.scan_bundles()
            key = skill_commands.resolve_slash_key(name, bundles)
            if key:
                built = skill_bundles.build_bundle_invocation_message(key, arg,
                    task_id=session['session_key'], platform=server._session_source(session), bundle_info=bundles[key])
                if built is None:
                    raise ConversationCommandError('The selected bundle has no available skills.', 'command_unavailable')
                return built[0]
            skills = skill_commands.scan_skill_commands()
            key = skill_commands.resolve_slash_key(name, skills)
            if key:
                built = skill_commands.build_skill_invocation_message(key, arg,
                    task_id=session['session_key'], skill_info=skills[key])
                if built is None:
                    raise ConversationCommandError('The selected skill could not be loaded.', 'command_unavailable')
                return built
            return None
        finally:
            server._clear_session_context(tokens)
            reset_terminal_scope(terminal_token)


class ConversationCommands:
    def __init__(self, service):
        self.service = service

    def execute(self, conversation_id, participant_id, expected_generation, expected_revision, command):
        from tui_gateway.conversation_controls import _live_generation
        service = self.service
        with service._lock:
            service._authorize(conversation_id)
            record = service.store.get(conversation_id)
            if record.revision != expected_revision:
                raise ConversationCommandError('Conversation changed; reload before running the command.', 'stale_revision')
            binding = next((b for b in service.store.participants(conversation_id)
                            if b.participant.participant_id == participant_id), None)
            if binding is None or binding.session_generation != expected_generation:
                raise ConversationCommandError('Participant generation changed.', 'stale_generation')
            live = _live_generation(service, conversation_id, participant_id, expected_generation)
            if live is None:
                raise ConversationCommandError('Prepare the selected participant before running commands.', 'runtime_unavailable')
            sid, session = live
            parts = command.strip().lstrip('/').split(maxsplit=1)
            name, arg = (parts[0].lower(), parts[1] if len(parts) > 1 else '') if parts else ('', '')
            output = read_command_output(service.server, sid, session, name, arg)
            if output is None:
                if name in _REFRESH_COMMANDS:
                    raise ConversationCommandError(
                        'Explicitly refresh the participant through conversations.refresh to change its generation.',
                        'refresh_required')
                owner = service._authorize(conversation_id, write=True)
                body = _expand_selected_command(service.server, sid, session, name, arg)
                if body is None:
                    raise ConversationCommandError('This command is not supported by the conversation coordinator.',
                                                   'unsupported_command')
                from gateway.hosted_room_conversation_commands import ConversationCommandTokens
                display = '/' + name + (' ' + arg if arg else '')
                token = ConversationCommandTokens(service.db_path).issue(owner=owner, binding=binding,
                    revision=expected_revision, display=display, body=body)
                return {'type': 'send', 'command_token': token, 'display': display,
                        'conversation_id': conversation_id, 'participant_id': participant_id,
                        'session_generation': expected_generation, 'conversation_revision': expected_revision,
                        'runtime_id': sid}
            return {'type': 'notice', 'scope': 'private', 'output': output or '(no output)',
                    'conversation_id': conversation_id, 'participant_id': participant_id,
                    'session_generation': expected_generation, 'conversation_revision': expected_revision,
                    'runtime_id': sid}


def register(server):
    def handle(rid, params):
        from pydantic import ValidationError
        from tui_gateway.contracts.registry import METHODS, check_result
        contract = METHODS['conversations.command']
        try:
            request = contract.params.model_validate(params, strict=True).model_dump(mode='json')
        except ValidationError as exc:
            return server._err(rid, 4000, str(exc))
        try:
            result = ConversationCommands(server.get_conversation_service()).execute(**request)
            check_result(contract, result)
            return server._ok(rid, result)
        except ConversationCommandError as exc:
            return server._err(rid, 4120, str(exc), data={'reason': exc.reason})
        except (ConversationBindingError, hosted_rooms.HostedRoomError, ValueError) as exc:
            return server._err(rid, 4120, str(exc), data={'reason': 'command_unavailable'})
    server.register_method('conversations.command', handle)
    server._LONG_HANDLERS |= frozenset(('conversations.command',))
