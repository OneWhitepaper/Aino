"""A Bot Chat may be opened before its profile has selected a model.

The durable follow policy resolves its model at use time. Creating it and restoring the
same receipt must agree, including receipts written by older owners before configuration.
"""

from tests.fixtures.storage_read import session_row
from dataclasses import asdict
import json

import pytest
from tests.gateway.fixtures.storage_handles import close_storage_handles

pytestmark = pytest.mark.usefixtures("authority_cwd_in_tmp")

from tests.gateway.test_bot_chat_follows_profile import home as home  # noqa: PLC0414 -- pytest injects the imported fixture by name
from tests.gateway.test_follow_profile_followups import _create_bot_chat, _profile
from tests.gateway.test_session_follow_profile_config import _owner, _route


@pytest.mark.asyncio
@pytest.mark.parametrize('first', ['desktop', 'delivery'])
async def test_unconfigured_bot_chat_survives_create_and_cold_restore(home, first):
    from gateway.session_bot import _target
    from gateway.session_local_recovery import restore_local_session
    from gateway.session_policy import policy_for_source

    (home / 'config.yaml').write_text(json.dumps({'model': {'default': '', 'provider': ''}}))
    store, runner, authority, owner = _owner(home)
    runner._peek_session_state = lambda key: None
    try:
        if first == 'desktop':
            live = await _create_bot_chat(owner, authority, home, 'bot', title='Bot Chat', hidden=True)
        else:
            _ref, live, _entry = await _target(authority, owner.actor)
        sid = authority.persistence.sessions.get_by_title('Bot Chat').session_id
        policy = policy_for_source(runner, live.source)
        assert policy.follows_profile and policy.model is None
        receipt = asdict(authority.persistence.bindings.receipt(sid))
        assert receipt['policy']['model'] is None
        assert session_row(authority.persistence, sid)['message_count'] == 0
    finally:
        await owner.close()
        store.close_all_db_handles()

    store, runner, authority, owner = _owner(home)
    runner._peek_session_state = lambda key: None
    try:
        assert restore_local_session(authority, sid).session_id == sid
        # Selecting a profile model after opening the chat must work without replacing its identity.
        _profile(home, 'configured', 1, 'profile-key')
        live = authority.sessions[sid]
        assert _route(runner, live) == ('configured', 'http://127.0.0.1:1/v1', 'profile-key')
        reopened = await _create_bot_chat(owner, authority, home, 'open', title='Bot Chat', hidden=True)
        assert reopened is live
        assert asdict(authority.persistence.bindings.receipt(sid))['policy']['model'] is None
    finally:
        await owner.close()
        store.close_all_db_handles()


@pytest.mark.parametrize('follow,model', [(False, None), (False, ''), (True, '')])
def test_writer_shaped_empty_model_receipts_restore_without_changing_identity(home, follow, model):
    from gateway.session_policy import build_policy, restore_policy

    policy = build_policy({'source': 'gui', 'cwd': str(home), 'model': 'configured',
                           'follow_profile_config': follow}, {})
    # Both local and kanban writers persist empty models; restore must retain
    # the creation request instead of inventing a new model or session identity (#148540).
    receipt = {**asdict(policy), 'model': model}
    restored = restore_policy(receipt)
    assert asdict(restored) == receipt
    assert restored.follows_profile is follow


@pytest.mark.parametrize('follow,changes', [
    (True, {'model': ' '}),
    (True, {'model': 1}),
    (True, {'model': {}}),
    (True, {'model': None, 'config_json': '[]'}),
    (True, {'model': None, 'request_json': '[]'}),
    (True, {'model': None, 'cwd': 'relative'}),
    (True, {'model': None, 'platform': 'cli'}),
])
def test_follow_model_deferral_keeps_private_policy_validation(home, follow, changes):
    from gateway.session_policy import build_policy, restore_policy
    from persistence import AuthorityRefusal

    policy = build_policy({'source': 'gui', 'cwd': str(home), 'model': 'configured',
                           'follow_profile_config': follow}, {})
    with pytest.raises(AuthorityRefusal) as refused:
        restore_policy({**asdict(policy), **changes})
    assert refused.value.reason == 'storage_unavailable'
