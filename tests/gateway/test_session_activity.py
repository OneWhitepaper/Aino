"""Runtime activity is a redacted projection, never a viewer or another execution owner."""
from gateway.session_events import SessionEvents


def _start(events, admission='first', generation=1):
    events.execution = {'authority_epoch': 1, 'admission_id': admission, 'execution_generation': generation}
    assert events.publish('session', {}, event_type='message.start') is False


def test_real_events_project_activity_without_claiming_text_delivery():
    events = SessionEvents()
    _start(events)
    assert events.activity_for('first', 1) == 'thinking'
    assert events.publish('session', {'tool_id': 'read', 'name': 'read_file', 'args': {'path': 'private'}}, event_type='tool.start') is False
    assert events.activity_for('first', 1) == 'reading'
    events.publish('session', {'tool_id': 'cmd', 'name': 'terminal', 'args': {'command': 'private'}}, event_type='tool.start')
    events.publish('session', {'tool_id': 'read'}, event_type='tool.complete')
    assert events.activity_for('first', 1) == 'running_command'
    assert events.publish('session', {'text': 'complete final text'}, event_type='message.delta') is False
    assert events.activity_for('first', 1) == 'running_command'
    events.publish('session', {'tool_id': 'unknown'}, event_type='tool.complete')
    assert events.activity_for('first', 1) == 'running_command'
    events.publish('session', {'tool_id': 'cmd'}, event_type='tool.complete')
    assert events.activity_for('first', 1) == 'thinking'
    events.publish('session', {'text': 'final reply'}, event_type='message.delta')
    assert events.activity_for('first', 1) == 'replying'
    events.publish('session', {'text': None}, event_type='message.delta')
    assert events.activity_for('first', 1) == 'replying'
    events.publish('session', {'result': {'final_response': 'complete final text'}}, event_type='message.complete')
    assert events.activity_for('first', 1) is None
    assert events.since(events.epoch, 0)['events'][-1]['payload']['result']['final_response'] == 'complete final text'
    events.publish('session', {'tool_id': 'late', 'name': 'read_file'}, event_type='tool.start')
    assert events.activity_for('first', 1) is None


def test_new_execution_release_and_late_frames_do_not_restore_old_activity():
    events = SessionEvents()
    _start(events)
    old = dict(events.execution)
    events.publish('session', {'tool_id': 'old', 'name': 'write_file'}, event_type='tool.start')
    _start(events, 'second', 2)
    assert events.activity_for('first', 1) is None
    events.publish('session', {'tool_id': 'new', 'name': 'read_file'}, event_type='tool.start')
    events.publish('session', {'tool_id': 'old'}, event_type='tool.complete', execution=old)
    events.publish('session', {}, event_type='message.complete', execution=old)
    assert events.activity_for('second', 2) == 'reading'
    events.release()
    assert events.activity_for('second', 2) is None
    events.publish('session', {'text': 'response'}, event_type='message.delta')
    assert events.activity_for('second', 2) == 'replying'
    events.execution = {}
    assert events.activity_for('second', 2) is None
