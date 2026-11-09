"""Redacted presentation of the existing execution stream; never a delivery consumer."""
from collections.abc import Mapping


ACTIVITY_KINDS = frozenset({
    'thinking', 'reading', 'editing', 'searching', 'running_command',
    'browser', 'image', 'replying', 'working',
})
_TOOL_ACTIVITIES = {
    'read_file': 'reading', 'read_terminal': 'reading',
    'write_file': 'editing', 'patch': 'editing', 'apply_patch': 'editing',
    'search_files': 'searching', 'web_search': 'searching',
    'terminal': 'running_command', 'execute_code': 'running_command',
    'web_extract': 'browser', 'browser_navigate': 'browser', 'browser_snapshot': 'browser',
    'browser_exec': 'browser', 'browser_cdp': 'browser', 'browser_dialog': 'browser',
    'browser_click': 'browser', 'browser_type': 'browser', 'browser_scroll': 'browser',
    'browser_back': 'browser', 'browser_press_key': 'browser', 'browser_vision': 'browser',
    'image_generate': 'image', 'generate_image': 'image', 'image_gen': 'image',
}
_IDENTITY_FIELDS = ('authority_epoch', 'admission_id', 'execution_generation')


class ExecutionActivity:
    """One stream's display projection. Tool IDs correlate overlaps; arguments never enter it."""

    def __init__(self):
        self.clear()

    def clear(self):
        self.identity = None
        self.phase = None
        self.tools = {}
        self.completed = False

    def update(self, execution, event_type, payload):
        identity = tuple(execution.get(key) for key in _IDENTITY_FIELDS)
        if any(value is None for value in identity) or not isinstance(payload, Mapping):
            return
        if event_type == 'message.start':
            self.clear()
            self.identity, self.phase = identity, 'thinking'
            return
        if event_type == 'message.complete':
            if self.identity == identity:
                self.phase, self.tools, self.completed = None, {}, True
            return
        if self.identity not in (None, identity):
            return
        if self.completed:
            return
        self.identity = identity
        handler = {'tool.start': self._tool_start, 'tool.complete': self._tool_complete,
                   'agent.step': self._thinking, 'thinking.delta': self._thinking_delta,
                   'reasoning.delta': self._thinking_delta, 'message.delta': self._replying_delta,
                   'message.interim': self._replying_delta}.get(event_type)
        if handler is not None:
            handler(payload)

    def _tool_start(self, payload):
        call_id = payload.get('tool_id') or payload.get('tool_call_id')
        name = payload.get('name') or payload.get('tool_name')
        if isinstance(call_id, str) and call_id:
            self.tools[call_id] = _TOOL_ACTIVITIES.get(name, 'working') if isinstance(name, str) else 'working'

    def _tool_complete(self, payload):
        call_id = payload.get('tool_id') or payload.get('tool_call_id')
        if isinstance(call_id, str) and self.tools.pop(call_id, None) is not None:
            self.phase = 'thinking'

    def _thinking(self, _payload):
        self.phase = 'thinking'

    def _thinking_delta(self, payload):
        if isinstance(payload.get('text'), str) and payload['text']:
            self.phase = 'thinking'

    def _replying_delta(self, payload):
        if isinstance(payload.get('text'), str) and payload['text']:
            self.phase = 'replying'

    def current(self, execution):
        if self.identity != tuple(execution.get(key) for key in _IDENTITY_FIELDS):
            return None
        return next(reversed(self.tools.values()), self.phase)
