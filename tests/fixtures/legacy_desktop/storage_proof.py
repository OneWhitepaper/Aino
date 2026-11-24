"""Real-store ownership checks shared by offline and native Desktop acceptance."""

from pathlib import Path
from types import SimpleNamespace
from uuid import NAMESPACE_OID, uuid5

from gateway.session_platform_model import binding_key
from persistence.conversation.messages import ConversationRequest
from persistence_assembly import open_persistence, profile_scope


def assert_profile_turn_storage(home, profile, billing_id, prompt, response):
    """Require the billed named transcript and no matching turn in the default home."""
    home = Path(home)
    found = []
    for scope in (home, home / "profiles" / profile):
        with open_persistence(profile_scope(home=scope)) as store:
            if scope == home:
                # Correlation UUIDs include the profile, so filtering on the
                # named UUID cannot reveal a second write in the default home.
                exported = store.maintenance.export_all(include_compacted=True, include_inactive=True)
                assert not any(
                    (row.role == "user" and prompt in str(row.content))
                    or (row.role == "assistant" and response in str(row.content))
                    for session in exported for row in session.messages
                ), "default store contains the named turn"
            matches = []
            for sid in store.bindings.local_session_ids():
                key = binding_key(SimpleNamespace(profile_id=str(scope.resolve())), sid)
                if str(uuid5(NAMESPACE_OID, key)) != billing_id:
                    continue
                target = store.bindings.receipt(sid).current_target
                rows = store.messages.read_conversation(target, ConversationRequest())
                assert store.sessions.get(target) is not None
                matches.append({
                    "user": any(row.role == "user" and prompt in str(row.content) for row in rows),
                    "assistant": any(row.role == "assistant" and response in str(row.content) for row in rows),
                })
            found.append(matches)
    assert found == [[], [{"user": True, "assistant": True}]], "named turn ownership mismatch"
