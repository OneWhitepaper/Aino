"""A compression continuation keeps the managed account identity across cold resume."""

from persistence_assembly import open_persistence, profile_scope
from persistence.conversation.sessions import NewSession
from persistence.conversation.messages import NewMessage
from persistence.conversation.lineage import CompressionChild


def test_rotated_managed_session_keeps_nonsecret_identity(tmp_path):
    metadata = {
        "model_source": "aino",
        "platform_owner": {"platform_origin": "http://127.0.0.1:17321", "user_id": "account-1"},
        "model_id": "catalog-a",
        "model": "upstream-model",
        "api_mode": "chat_completions",
        "provider": "aino",
        "api_key": "credential-sentinel",
    }
    db = open_persistence(profile_scope(home=tmp_path))
    try:
        db.sessions.create(NewSession(session_id="root", source="gui", model="upstream-model", model_config=metadata))
        db.messages.append("root", NewMessage(role="user", content="hello"))
        db.lineage.publish_compression_child("root", CompressionChild(
            session_id="tip", source="gui", model="upstream-model", model_config={"_compressed_from": "root"}),
            [NewMessage(role="assistant", content="summary")], require_compression_lease=False)
    finally:
        db.close()

    reopened = open_persistence(profile_scope(home=tmp_path))
    try:
        child = reopened.sessions.get("tip").model_config
        from persistence.conversation.sessions import parse_model_config as _parse_model_config
        config = child
        assert {key: config[key] for key in ("model_source", "platform_owner", "model_id", "model", "api_mode", "provider")} == {
            key: metadata[key] for key in ("model_source", "platform_owner", "model_id", "model", "api_mode", "provider")}
        assert config["_compressed_from"] == "root"
        assert "api_key" not in config
    finally:
        reopened.close()
