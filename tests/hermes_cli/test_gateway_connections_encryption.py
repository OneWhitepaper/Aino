"""An explicit desktop encryption opt-in survives the shared gateway store's Python writers."""
import json

import pytest

from hermes_cli import gateway_connections as store

LOCKED = {"encoding": "safeStorage", "value": "djEw-encrypted"}


@pytest.fixture
def protected(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    store.store_path().write_text(json.dumps({
        "version": 2, "revision": 1, "secretStorage": "safeStorage",
        "connections": [{"id": "box", "kind": "remote", "label": "Box", "url": "https://box.test",
                         "authMode": "token", "token": LOCKED,
                         "headers": {"X-Access-Secret": LOCKED}}]}))
    store.tokens_path().write_text(json.dumps({
        "version": 1, "revision": 1, "secretStorage": "safeStorage", "tokens": {}, "unbound": {}}))
    return tmp_path


def test_protected_metadata_edits_keep_envelopes_and_removal_still_works(protected):
    public = store.public_registry(store.read_registry())
    assert public["secretStorage"] == "safeStorage"
    assert public["connections"][1]["tokenSet"] is True
    assert "djEw-encrypted" not in json.dumps(public)
    store.save_connection({"id": "box", "kind": "remote", "label": "Renamed"})
    store.set_last_used("box")
    doc = json.loads(store.store_path().read_text())
    assert doc["secretStorage"] == "safeStorage"
    assert doc["connections"][1]["token"] == LOCKED
    assert doc["connections"][1]["headers"] == {"X-Access-Secret": LOCKED}
    store.remove_connection("box")
    assert [c["id"] for c in store.read_registry()["connections"]] == ["local"]
    assert json.loads(store.store_path().read_text())["secretStorage"] == "safeStorage"


@pytest.mark.parametrize("change", [{"token": "replacement"}, {"headers": {"X-Access-Secret": "replacement"}}])
def test_protected_credentials_cannot_be_overwritten_in_plaintext(protected, change):
    before = store.store_path().read_bytes()
    with pytest.raises(store.ConnectionStoreError, match="desktop_unlock_required"):
        store.save_connection({"id": "box", "kind": "remote", "label": "Box", **change})
    assert store.store_path().read_bytes() == before


def test_tokens_policy_alone_also_blocks_plaintext_credential_writes(protected):
    """The two policy files can briefly disagree while Desktop changes encryption."""
    registry = json.loads(store.store_path().read_text())
    registry["secretStorage"] = "plain"
    store.store_path().write_text(json.dumps(registry))
    before = store.store_path().read_bytes()

    with pytest.raises(store.ConnectionStoreError, match="desktop_unlock_required"):
        store.save_connection({"id": "box", "kind": "remote", "label": "Box", "token": "replacement"})

    assert store.store_path().read_bytes() == before
    from hermes_cli import gateway_connections_oauth as oauth
    with pytest.raises(store.ConnectionStoreError, match="desktop_unlock_required"):
        oauth.start_sign_in("box", bound_host="127.0.0.1", bound_port=1234)


@pytest.mark.parametrize("field", ["token", "headers"])
def test_dial_never_silently_omits_a_locked_credential(protected, field):
    doc = json.loads(store.store_path().read_text())
    entry = doc["connections"][0]
    if field == "headers":
        entry["token"] = {"encoding": "plain", "value": "usable-token"}
    else:
        entry.pop("headers")
    store.store_path().write_text(json.dumps(doc))
    with pytest.raises(store.ConnectionStoreError, match="desktop_unlock_required"):
        store.dial_snapshot("box")


def test_encrypted_oauth_stays_bound_and_cannot_be_replaced_by_python(protected):
    doc = json.loads(store.store_path().read_text())
    doc["connections"][0].update(authMode="oauth", token=None, headers={})
    store.store_path().write_text(json.dumps(doc))
    token_doc = {"version": 1, "revision": 2, "secretStorage": "safeStorage", "tokens": {
        "box": {**LOCKED, "baseUrl": "https://box.test"}}, "unbound": {}}
    store.tokens_path().write_text(json.dumps(token_doc))
    before = store.tokens_path().read_bytes()
    with pytest.raises(store.ConnectionStoreError, match="desktop_unlock_required"):
        store.read_tokens("box")
    with pytest.raises(store.ConnectionStoreError, match="desktop_unlock_required"):
        store.write_tokens("box", {"accessToken": "new", "refreshToken": "refresh"})
    assert store.tokens_path().read_bytes() == before
    token_doc["tokens"]["box"]["baseUrl"] = "https://other.test"
    store.tokens_path().write_text(json.dumps(token_doc))
    assert store.read_tokens("box") is None  # no attempt to open another issuer's token
    store.write_tokens("box", None)
    assert store.read_tokens("box") is None
    assert json.loads(store.tokens_path().read_text())["secretStorage"] == "safeStorage"
