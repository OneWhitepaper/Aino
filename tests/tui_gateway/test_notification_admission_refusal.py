"""A refused legacy turn is not a completion delivery receipt."""
import queue
import threading
from types import SimpleNamespace

import pytest

from tui_gateway import server


@pytest.mark.parametrize('kind', ['async_delegation', 'completion'])
def test_refused_notification_retains_result_without_spending_attempts(tmp_path, monkeypatch, kind):
    from tests.gateway.test_completion_admission import pending
    from tools import async_delegation as delegation
    from tools.process_registry import process_registry

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    event = pending('owned', 'refused-notification') if kind == 'async_delegation' else {
        'type': 'completion', 'session_id': 'owned-process', 'session_key': 'owned'}
    session = {'history_lock': threading.RLock(), 'running': True}
    emitted = []
    events = queue.Queue()
    monkeypatch.setattr(process_registry, 'completion_queue', events)
    monkeypatch.setattr(server, '_emit', lambda *args: emitted.append(args))
    monkeypatch.setattr(server, '_notif_refusal_backoff', lambda _session: None)
    monkeypatch.setattr(server, '_run_prompt_submit', lambda *args, **kwargs: False)
    registry = SimpleNamespace(completion_queue=events, is_completion_consumed=lambda _: False)

    def dispatch():
        session['running'] = kind == 'async_delegation'
        if kind == 'async_delegation':
            if not server._notif_dispatch_event('live', session, event, 'nonhuman summary'):
                events.put(event)
        else:
            server._notif_dispatch_completions('live', session, [(event, 'result')], registry, None)

    for _ in range(10):
        dispatch()
        if kind == 'async_delegation':
            record = delegation.get_durable_delegation(event['delegation_id'])
            assert (record['delivery_state'], record['delivery_attempts']) == ('pending', 0), record
        assert events.get_nowait() == event
        assert session['running'] is False
    assert not any(e[0] == 'message.start' for e in emitted), emitted
    accepted = []

    def accept(*args, **kwargs):
        accepted.append((args, kwargs))
        return True

    monkeypatch.setattr(server, '_run_prompt_submit', accept)
    dispatch()
    if kind == 'async_delegation':
        assert delegation.get_durable_delegation(event['delegation_id'])['delivery_state'] == 'delivered'
        assert accepted[0][1]['display_kind'] == 'async_delegation_complete'
    assert len(accepted) == 1 and events.empty()
