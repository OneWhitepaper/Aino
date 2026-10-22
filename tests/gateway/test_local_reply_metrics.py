"""Canonical Desktop replies retain the embedded TUI's diagnostics and billing receipts."""
from types import SimpleNamespace

import pytest

from agent.auxiliary_billing_scope import ManagedCredential, billing_scope, record_model_call_source
from gateway.config import Platform
from gateway.run_turn_runner import TurnRunner
from gateway.session import SessionSource
from gateway.session_events import SessionEvents
from gateway.session_results import execution_result
from gateway.session_settlement_recovery import completion_payload
from gateway.turn_context import TurnContext
from hermes_state import SessionDB
from tests.gateway.test_local_viewer_events_submit import _gateway_runner, _RecordingAgent


class _StoredAgent(_RecordingAgent):
    background = False
    outcome = 'complete'
    error = None
    failure_reason = None
    failure_retryable = True
    partial = False

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._session_db = kwargs['session_db']
        self.api_key = kwargs['api_key']
        self.provider = kwargs['provider']
        self.session_total_tokens = self.session_output_tokens = 0

    def run_conversation(self, message, **kwargs):
        self.scope = billing_scope.get()
        if self.scope is not None:
            if isinstance(self.api_key, ManagedCredential):
                self.scope.calls.record('chat-call', 'chat')
            record_model_call_source(credential=self.api_key)
            if self.background:
                self.scope.calls.start_background()
        self.session_prompt_tokens += 100
        self.session_total_tokens += 120
        self.session_output_tokens += 20
        history = kwargs['conversation_history']
        self._persist_user_message_idx = len(history)
        user = {'role': 'user', 'content': message}
        answer = {'role': 'assistant', 'content': 'same answer'}
        for row in (user, answer):
            row['_row_id'] = self._session_db.append_message(self.session_id, row['role'], row['content'])
        self.answer = answer
        return {'final_response': 'same answer', 'messages': [*history, user, answer],
                'completed': self.outcome == 'complete', 'interrupted': self.outcome == 'interrupted',
                'failed': self.outcome == 'error', 'error': self.error, 'failure_reason': self.failure_reason,
                'failure_retryable': self.failure_retryable, 'partial': self.partial}


def _run(db, authority, *, managed=True, history=None, session_id='sid'):
    runner = _gateway_runner()
    runner._session_db = SimpleNamespace(_db=db)
    key = (ManagedCredential(lambda: 'fixture-secret', 'user', 'billing-session', 'm',
                             'http://127.0.0.1/v1', 'chat_completions', False) if managed else 'byok')
    runner._resolve_session_agent_runtime.return_value = ('m', {'provider': 'custom', 'api_key': key})
    ctx = TurnContext(
        source=SessionSource(platform=Platform.LOCAL, chat_id='sid', user_id='u'),
        message='question', history=history or [], session_id=session_id, session_key='key', user_config={},
        AIAgent=_StoredAgent, resolve_display_setting=lambda *_a: False,
        _run_still_current=lambda: True, _hooks_ref=SimpleNamespace(loaded_hooks=False))
    captured = {}
    token = execution_result.set(captured)
    try:
        turn = TurnRunner(runner, ctx)
        turn._approval_owner = (authority, 'sid', 1)
        turn.run_sync()
    finally:
        execution_result.reset(token)
    result = captured['result']
    outcome = ('interrupted' if result.get('interrupted') else
               'failed' if result.get('failed') else 'completed')
    complete = completion_payload({'admission_id': 'a', 'request_id': 'r'},
                                  {'outcome': outcome}, 'same answer', captured)
    return complete, ctx.agent_holder[0]


@pytest.fixture
def stored(tmp_path, monkeypatch):
    # This fixture supplies its own non-network credential; native account tests cover lease binding.
    monkeypatch.setattr('gateway.session_platform_model.managed_agent_context', lambda *args: None)
    with SessionDB(db_path=tmp_path / 'state.db') as db:
        db.create_session('sid', source='desktop')
        live = SimpleNamespace(tool_progress_mode=None, event_stream=SessionEvents())
        authority = SimpleNamespace(sessions={'sid': live}, profile_id='p', adopt_agent=lambda *a: None)
        yield db, authority, live


@pytest.mark.parametrize('managed', [True, False])
def test_canonical_reply_projects_and_persists_existing_metrics(stored, managed):
    db, authority, _ = stored
    db.append_message('sid', 'user', 'old question')
    db.append_message('sid', 'assistant', 'old answer')
    prefix = db.get_messages_as_conversation('sid')
    complete, agent = _run(db, authority, managed=managed, history=prefix)
    metrics = complete.get('turn_metrics')
    assert metrics is not None, complete
    assert metrics['total_tokens'] == 120 and metrics['input_tokens'] == 100
    if managed:
        assert metrics['billing']['calls'] == [{'call_id': 'chat-call', 'purpose': 'chat'}]
        assert metrics['billing']['calls_complete'] is True
    else:
        assert metrics['non_aino_model_calls'] is True and 'billing' not in metrics
    with SessionDB(db_path=db.db_path) as reopened:
        history = reopened.get_messages_as_conversation('sid')
    assert history[-1]['display_metadata']['turn_metrics'] == metrics
    assert all('display_metadata' not in row for row in prefix)
    assert 'display_metadata' not in agent.answer  # display writes never mutate the model prefix
    assert billing_scope.get() is None


def test_late_receipt_stays_on_original_reply_after_next_turn(stored, monkeypatch):
    db, authority, live = stored
    frames = []
    live.event_stream.observers.add(frames.append)
    monkeypatch.setattr(_StoredAgent, 'background', True)
    first, agent = _run(db, authority)
    assert first.get('turn_metrics'), first
    first_bill = first['turn_metrics']['billing']
    assert first_bill['calls_complete'] is False
    monkeypatch.setattr(_StoredAgent, 'background', False)
    # Compression moved the physical agent; the logical viewer now runs a later generation.
    db.create_session('tip', source='desktop', parent_session_id='sid')
    agent.session_id = 'tip'
    second, _ = _run(db, authority, session_id='tip')
    live.event_stream.execution = {'execution_generation': 2, 'admission_id': 'new-admission'}
    agent.scope.calls.record('late-title', 'title')
    agent.scope.calls.record_non_aino_model_call()
    agent.scope.calls.end_background()
    updates = [f['params'] for f in frames if f['params']['type'] == 'session.usage'
               and f['params']['payload'].get('reply_billing')]
    assert updates and updates[-1]['payload']['reply_billing']['turn_id'] == first_bill['turn_id']
    assert updates[-1]['payload']['reply_billing']['calls_complete'] is True
    assert updates[-1]['payload']['reply_non_aino_model_calls'] is True
    assert 'execution_generation' not in updates[-1] and 'admission_id' not in updates[-1]
    with SessionDB(db_path=db.db_path) as reopened:
        original = reopened.get_messages_as_conversation('sid')[-1]['display_metadata']['turn_metrics']
        later = reopened.get_messages_as_conversation('tip')[-1]['display_metadata']['turn_metrics']
    assert {call['purpose'] for call in original['billing']['calls']} == {'chat', 'title'}
    assert original['non_aino_model_calls'] is True
    assert later['billing']['turn_id'] == second['turn_metrics']['billing']['turn_id']
    assert {call['purpose'] for call in later['billing']['calls']} == {'chat'}


@pytest.mark.parametrize('outcome', ['interrupted', 'error'])
def test_failed_or_interrupted_turn_does_not_stamp_a_successful_reply(stored, monkeypatch, outcome):
    db, authority, _ = stored
    monkeypatch.setattr(_StoredAgent, 'outcome', outcome)
    complete, _ = _run(db, authority)
    assert complete.get('turn_metrics'), complete
    assert 'display_metadata' not in db.get_messages_as_conversation('sid')[-1]


@pytest.mark.parametrize(('reason', 'error', 'layer', 'retryable'), [
    ('rate_limit', 'HTTP 429: rate limit exceeded', 'provider', True),
    ('managed_credential_revoked', 'Aino model authorization was revoked.', 'auth', False),
])
def test_live_failure_retains_classified_recovery_and_details(stored, monkeypatch, reason, error, layer, retryable):
    db, authority, _ = stored
    monkeypatch.setattr(_StoredAgent, 'outcome', 'error')
    monkeypatch.setattr(_StoredAgent, 'error', error)
    monkeypatch.setattr(_StoredAgent, 'failure_reason', reason)
    monkeypatch.setattr(_StoredAgent, 'failure_retryable', retryable)
    complete, _ = _run(db, authority)
    assert complete.get('error_surface') is not None, complete
    assert complete['error_surface'] == {
        **complete['error_surface'], 'layer': layer, 'code': reason, 'retryable': retryable,
        'model': 'm', 'provider': 'custom'}
    assert complete['error'] == error
    assert complete['status'] == 'error'
    if reason.startswith('managed_'):
        assert 'auth_kind' not in complete['error_surface']  # Aino account recovery cannot edit a provider key.


def test_failed_partial_reply_keeps_its_text_separate_from_error_details(stored, monkeypatch):
    db, authority, _ = stored
    monkeypatch.setattr(_StoredAgent, 'outcome', 'error')
    monkeypatch.setattr(_StoredAgent, 'partial', True)
    monkeypatch.setattr(_StoredAgent, 'error', 'connection reset mid-stream')
    monkeypatch.setattr(_StoredAgent, 'failure_reason', 'server_error')
    complete, _ = _run(db, authority)
    assert complete.get('partial') is True, complete
    assert complete['text'] == 'same answer'
    assert complete['error'] == 'connection reset mid-stream'
