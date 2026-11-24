"""A named positive cannot conceal a duplicate default-profile transcript."""

from types import SimpleNamespace
from uuid import NAMESPACE_OID, uuid5

import pytest

from gateway.session_platform_model import binding_key
from persistence.authority.bindings import NewSessionBinding, local_session_id
from persistence.conversation.messages import NewMessage
from persistence_assembly import open_persistence, profile_scope
from tests.fixtures.legacy_desktop.storage_proof import assert_profile_turn_storage
from tests.fixtures.storage_seed import seed_session

PROMPT = "Read /fixture/unique-profile-turn and verify it."
RESPONSE = "Verified unique-profile-turn-content"


def seed_turn(home, *, bound=True, roles=("user", "assistant")):
    home.mkdir(parents=True, exist_ok=True)
    profile_id = str(home.resolve())
    sid = local_session_id(profile_id, "fixture-owner", "fixture-request")
    with open_persistence(profile_scope(home=home)) as store:
        if bound:
            epoch = store.runtime.begin_epoch(instance_id="storage-proof")
            route = f"agent:main:local:dm:{sid}"
            store.bindings.reserve(epoch=epoch, owner=None, binding=NewSessionBinding(
                profile_id=profile_id, principal_id="fixture-owner", request_id="fixture-request",
                session_id=sid, route=route,
                entry={"session_id": str(sid), "session_key": route,
                       "created_at": "2026-11-24T00:00:00+00:00", "updated_at": "2026-11-24T00:00:00+00:00",
                       "origin": {"chat_id": str(sid)}},
                policy={"source": "gui", "model": "fixture", "cwd": str(home), "request_json": "{}"},
                created_source="desktop"))
        else:
            seed_session(store, sid, "desktop", hidden=True, archived=True)
        for role in roles:
            store.messages.append(sid, NewMessage(role=role, content=PROMPT if role == "user" else RESPONSE))
    return str(uuid5(NAMESPACE_OID, binding_key(SimpleNamespace(profile_id=profile_id), sid)))


def test_accepts_the_exact_named_billed_turn_in_an_uncontaminated_store(tmp_path):
    billed = seed_turn(tmp_path / "profiles" / "named")
    assert_profile_turn_storage(tmp_path, "named", billed, PROMPT, RESPONSE)


@pytest.mark.parametrize("bound", [True, False])
@pytest.mark.parametrize("roles", [("user",), ("assistant",), ("user", "assistant")])
def test_rejects_default_content_even_under_another_uuid_or_without_any_binding(tmp_path, bound, roles):
    billed = seed_turn(tmp_path / "profiles" / "named")
    other = seed_turn(tmp_path, bound=bound, roles=roles)
    assert billed != other
    with pytest.raises(AssertionError, match="default"):
        assert_profile_turn_storage(tmp_path, "named", billed, PROMPT, RESPONSE)


def test_rejects_a_named_turn_with_the_wrong_billing_identity(tmp_path):
    seed_turn(tmp_path / "profiles" / "named")
    with pytest.raises(AssertionError, match="named"):
        assert_profile_turn_storage(tmp_path, "named", "wrong-billing-id", PROMPT, RESPONSE)
