"""Canonical compression must not rewrite Codex-owned conversation history."""
import pytest

from persistence.conversation.messages import NewMessage

from tests.gateway.test_session_create_tier_cwd import _owner
from tests.gateway.test_session_execution_mode import _create

pytestmark = pytest.mark.usefixtures('authority_cwd_in_tmp')


@pytest.mark.asyncio
@pytest.mark.parametrize(('execution_mode', 'api_mode'), [
    ('code', 'responses'), ('code', 'codex_responses'), ('work', 'codex_app_server'),
])
async def test_canonical_compress_requires_native_coordination_without_rewriting_history(
    tmp_path, monkeypatch, execution_mode, api_mode,
):
    store, runner, authority, owner = _owner(tmp_path / 'home', monkeypatch, {'model': {'default': 'm'}})
    runner._resolve_session_agent_runtime = lambda **_kw: ('m', {'api_mode': api_mode})
    monkeypatch.setattr('agent.context_compressor.ContextCompressor.__init__', lambda *_args, **_kw: None)
    monkeypatch.setattr('agent.context_compressor.ContextCompressor.compress',
                        lambda *_args, **_kw: pytest.fail('Hermes must not summarize a Codex-owned thread'))
    try:
        created = (await _create(owner, tmp_path, 'create', execution_mode=execution_mode))['result']
        sid = created['session_id']
        authority.persistence.messages.append(sid, NewMessage(role='user', content='native context'))
        authority.persistence.messages.append(sid, NewMessage(role='assistant', content='native reply'))
        before = authority.persistence.sessions.get(sid)
        history = authority.persistence.messages.read_transcript(sid)
        reply = await owner.dispatch({'id': 'compress', 'method': 'session.mutate', 'params': {
            'session_id': sid, 'request_id': 'compress', 'operation': 'compress', 'payload': {},
            'expected_revision': before.runtime_revision, 'expected_generation': before.runtime_generation}})
        assert reply['error']['message'] == 'runtime_coordination_required', reply
        after = authority.persistence.sessions.get(sid)
        assert (after.runtime_revision, after.runtime_generation) == (
            before.runtime_revision, before.runtime_generation)
        assert authority.persistence.messages.read_transcript(sid) == history
        assert not authority.persistence.state_meta.list_prefix('gateway.mutation.v1.')
    finally:
        await owner.close()
        store.close_all_db_handles()
