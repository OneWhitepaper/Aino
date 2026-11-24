"""Account transfers preserve exact provider sidecars, not their SQLite envelopes."""

import json

import pytest

from hermes_cli.session_export import to_legacy_export_dict
from persistence.conversation.content import API_CONTENT_JSON_PREFIX, effective_message_content
from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import NewSession

PARTS = [
    {"type": "text", "text": "look at this image"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
]
SIDECARS = [PARTS, "exact provider text", API_CONTENT_JSON_PREFIX + '{"content":[]}']


@pytest.mark.parametrize("sidecar", SIDECARS, ids=["image", "text", "reserved-text"])
def test_transcript_reads_expose_original_sidecar(backend, scope_a, sidecar):
    store = backend.open(scope_a)
    store.sessions.create(NewSession("turn", "cli"))
    store.messages.append("turn", NewMessage("user", "display text", api_content=sidecar))

    (row,) = store.messages.read_transcript("turn")
    assert row.api_content == sidecar


@pytest.mark.parametrize("sidecar", SIDECARS, ids=["image", "text", "reserved-text"])
@pytest.mark.parametrize("all_sessions", [False, True], ids=["single-export", "account-export"])
def test_account_export_import_preserves_exact_provider_history(backend, scope_a, scope_b, sidecar, all_sessions):
    source = backend.open(scope_a)
    target = backend.open(scope_b)
    source.sessions.create(NewSession("turn", "cli"))
    source.messages.append("turn", NewMessage("user", "display text", api_content=sidecar))
    source.messages.append("turn", NewMessage("assistant", "image received"))

    exports = source.maintenance.export_all() if all_sessions else (source.maintenance.export_session("turn"),)
    # Exercise the same JSON boundary as account recovery / Backup & Transfer.
    payload = json.loads(json.dumps([to_legacy_export_dict(item) for item in exports]))
    result = target.maintenance.import_sessions(payload)
    assert result.ok and result.imported == 1, result
    (user, reply) = target.messages.read_conversation("turn")
    assert effective_message_content(user.as_openai_message()) == sidecar
    assert user.content == "display text"
    assert reply.content == "image received"
    assert target.maintenance.export_session("turn").messages[0].api_content == sidecar
