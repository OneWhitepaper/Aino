"""A committed managed tool failure blocks crash recovery until an explicit new turn."""

import json
import threading

import pytest

from agent.replay_cleanup import canonicalize_replay_history
from agent.tool_result_classification import stamp_terminal_tool_failure
from hermes_state import SessionDB
from tui_gateway import server
from tui_gateway.turn_marker import read_turn_marker, record_turn_start


@pytest.mark.parametrize('later_user', [False, True], ids=['failed-turn', 'explicit-later-turn'])
@pytest.mark.parametrize('spill', [False, True], ids=['inline-result', 'spilled-result'])
def test_cold_byok_resume_honors_current_turn_terminal_tool_verdict(tmp_path, monkeypatch, later_user, spill):
    session_id = 'byok-with-managed-tool'
    payload = {'success': False, 'failure_reason': 'managed_operation_unknown', 'failure_retryable': False}
    content = 'Saved fixture result' if spill else json.dumps(payload)
    tool = {'role': 'tool', 'name': 'image_generate', 'tool_call_id': 'image-1', 'content': content}
    stamp_terminal_tool_failure(tool, payload)
    db_path = tmp_path / 'state.db'
    with SessionDB(db_path) as db:
        db.create_session(session_id, source='desktop', model='byok-model')
        db.append_message(session_id, 'user', 'Generate an image')
        db.append_message(session_id, 'assistant', '', tool_calls=[{
            'id': 'image-1', 'type': 'function', 'function': {'name': 'image_generate', 'arguments': '{}'}}])
        db.append_message(session_id, 'tool', content, tool_call_id='image-1', tool_name='image_generate',
                          display_metadata=tool['display_metadata'])
        if later_user:
            db.append_message(session_id, 'user', 'Now inspect a different file')
    with SessionDB(db_path) as reopened:
        history = canonicalize_replay_history(reopened.get_messages_as_conversation(session_id))
    assert [row['role'] for row in history[:3]] == ['user', 'assistant', 'tool']
    assert history[1]['tool_calls'][0]['id'] == history[2]['tool_call_id'] == 'image-1'
    assert history[2]['display_metadata']['terminal_failure']['failure_retryable'] is False
    prompt = 'Now inspect a different file' if later_user else 'Generate an image'
    record_turn_start(tmp_path, session_id, prompt)
    scheduled = []
    monkeypatch.setattr(server, '_hermes_home', tmp_path)
    monkeypatch.setattr(server, '_auto_continue_config', lambda: (True, 3600, 3))
    monkeypatch.setattr(server, 'marker_writer_state', lambda marker: 'dead')
    monkeypatch.setattr(server, '_start_session_work', lambda callback, **kwargs: scheduled.append(kwargs) or object())
    cold = {'session_key': session_id, 'profile_home': str(tmp_path), 'history': history,
            'history_lock': threading.Lock(), 'running': False, 'source': 'desktop'}

    result = server._maybe_schedule_auto_continue('viewer', cold, session_id)

    assert bool(scheduled) is later_user
    assert (result is not None) is later_user
    assert (read_turn_marker(tmp_path, session_id) is not None) is later_user
    with SessionDB(db_path) as reopened:
        rows = reopened.get_messages(session_id)
    assert rows[1]['tool_calls'][0]['id'] == rows[2]['tool_call_id'] == 'image-1'
    assert rows[2]['display_metadata'] == tool['display_metadata']
