"""A compression continuation keeps the managed account identity across cold resume."""

from hermes_state import SessionDB


def test_rotated_managed_session_keeps_nonsecret_identity(tmp_path):
    path = tmp_path / "state.db"
    metadata = {
        "model_source": "aino",
        "platform_owner": {"platform_origin": "http://127.0.0.1:17321", "user_id": "account-1"},
        "model_id": "catalog-a",
        "model": "upstream-model",
        "api_mode": "chat_completions",
        "provider": "aino",
        "api_key": "credential-sentinel",
    }
    db = SessionDB(path)
    try:
        db.create_session("root", source="gui", model="upstream-model", model_config=metadata)
        db.append_message("root", "user", "hello")
        db.publish_compression_child(
            parent_session_id="root", child_session_id="tip", source="gui",
            messages=[{"role": "assistant", "content": "summary"}],
            model="upstream-model", model_config={"_compressed_from": "root"},
            require_compression_lease=False)
    finally:
        db.close()

    reopened = SessionDB(path)
    try:
        child = reopened.get_session("tip")["model_config"]
        from hermes_state_sessions import _parse_model_config
        config = _parse_model_config(child)
        assert {key: config[key] for key in ("model_source", "platform_owner", "model_id", "model", "api_mode", "provider")} == {
            key: metadata[key] for key in ("model_source", "platform_owner", "model_id", "model", "api_mode", "provider")}
        assert config["_compressed_from"] == "root"
        assert "api_key" not in config
    finally:
        reopened.close()
