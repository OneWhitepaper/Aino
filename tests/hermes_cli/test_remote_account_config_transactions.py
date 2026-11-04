"""Explicit account settings commit their configuration and local credentials together."""

from copy import deepcopy
import sqlite3

import pytest

from tests.plugins.config_backends.test_remote_backend import plane, profile_plane

__all__ = ["plane", "profile_plane"]


def _windows(home):
    path = home / "telemetry/shared_metrics/metrics.sqlite3"
    if not path.exists():
        return []
    with sqlite3.connect(path) as db:
        return db.execute("SELECT * FROM send_consent_windows ORDER BY rowid").fetchall()


@pytest.mark.parametrize("locked,share", [("recipient", True), ("endpoint", True), ("send", False), ("enabled", False)])
def test_cli_consent_refusal_keeps_caller_config_and_windows(plane, locked, share):
    from hermes_cli.config_backend import ConfigLockedError
    from hermes_cli.observability.shared_metrics_consent import save_consent
    from hermes_cli.setup import _record_send_consent_change

    section = {"enabled": True, "send": True, "recipient": "aino" if not share else "nous",
               "endpoint": "https://old.example/metrics", "offer_version": 2}
    original = {"telemetry": {"shared_metrics": section}}
    plane.profile("default").update(values=deepcopy(original), version=1)
    plane.upper_locks = [{"path": f"telemetry.shared_metrics.{locked}", "level": "tenant"}]
    caller = deepcopy(original)
    _record_send_consent_change(enabled=True)
    before = _windows(plane.home)

    with pytest.raises(ConfigLockedError):
        save_consent(share, share, caller)

    assert caller == original
    assert plane.profile("default")["values"] == original
    assert plane.patches() == [] and _windows(plane.home) == before


def test_cli_consent_commits_all_answer_fields_once(plane):
    from hermes_cli.observability.shared_metrics_consent import consent_state, save_consent
    from hermes_cli.observability.shared_metrics_send_config import DEFAULT_ENDPOINT

    caller = {"display": {"personality": "retain"}}
    save_consent(True, True, caller)

    stored = plane.profile("default")["values"]
    assert stored["telemetry"]["shared_metrics"] == caller["telemetry"]["shared_metrics"]
    assert stored["telemetry"]["shared_metrics"]["endpoint"] == DEFAULT_ENDPOINT
    assert consent_state(stored)["send"] is True
    assert len(plane.patches()) == 1
    assert len(_windows(plane.home)) == 1 and _windows(plane.home)[0][2] is None


@pytest.mark.parametrize("empty_caller", [False, True])
def test_setup_consent_lock_does_not_print_success_or_mutate_the_wizard(plane, monkeypatch, empty_caller):
    from hermes_cli import setup
    from hermes_cli.config_backend import ConfigLockedError

    original = {"telemetry": {"shared_metrics": {"recipient": "nous", "enabled": False, "send": False}}}
    plane.profile("default").update(values=deepcopy(original), version=1)
    plane.upper_locks = [{"path": "telemetry.shared_metrics.recipient", "level": "tenant"}]
    monkeypatch.setattr(setup, "prompt_yes_no", lambda *a, **k: True)
    successes = []
    monkeypatch.setattr(setup, "print_success", successes.append)
    caller = {} if empty_caller else deepcopy(original)
    caller_before = deepcopy(caller)

    with pytest.raises(ConfigLockedError):
        setup.setup_telemetry(caller)

    assert successes == [] and caller == caller_before and _windows(plane.home) == []


def _endpoint(plane, monkeypatch):
    from hermes_cli.config import custom_endpoint_key_env, save_env_value
    from hermes_cli.model_switch import ModelSwitchResult
    from hermes_cli.web_routers import config_env

    slot = custom_endpoint_key_env("probe")
    original = {"providers": {"probe": {"name": "probe", "base_url": "https://old.example/v1",
        "model": "old-model", "key_env": slot}},
        "model": {"provider": "probe", "default": "old-model", "base_url": "https://old.example/v1", "key_env": slot}}
    plane.profile("default").update(values=deepcopy(original), version=1)
    save_env_value(slot, "original-endpoint-secret")
    monkeypatch.setattr(config_env, "_record_custom_endpoint_setup", lambda home: None)
    monkeypatch.setattr(config_env, "_validated_main_model_selection", lambda cfg, provider, model, base_url: ModelSwitchResult(
        success=True, new_model=model, target_provider=provider, provider_changed=True, base_url=base_url,
        api_mode="chat_completions", is_global=True))
    return config_env, slot, original


def _lock_on_save(plane, monkeypatch, config_env, schedule, section):
    from hermes_cli.config_backend import get_config_backend

    locks = [{"path": section, "level": "tenant"}]
    if schedule == "locked":
        plane.upper_locks = locks
        return
    backend = get_config_backend()
    save = config_env.save_config

    def late_lock(config, **kwargs):
        plane.upper_locks = locks
        if schedule == "late-poll":
            assert backend.poll_one(backend._state(plane.home))
        else:
            plane.profile("default")["version"] += 1
        return save(config, **kwargs)

    monkeypatch.setattr(config_env, "save_config", late_lock)


@pytest.mark.parametrize("schedule", ["locked", "late-poll", "late-retry"])
@pytest.mark.parametrize("key", ["replacement-endpoint-secret", ""])
@pytest.mark.parametrize("make_default,section", [(True, "model"), (True, "providers"), (False, "providers")])
def test_rejected_endpoint_edit_retains_definition_and_original_secret(
        plane, monkeypatch, schedule, key, make_default, section):
    from fastapi import HTTPException
    from hermes_cli.config import get_env_value
    from hermes_cli.web_models import CustomEndpointUpdate

    config_env, slot, original = _endpoint(plane, monkeypatch)
    before = (plane.home / ".env").read_bytes()
    _lock_on_save(plane, monkeypatch, config_env, schedule, section)

    with pytest.raises(HTTPException) as error:
        config_env.upsert_custom_endpoint(CustomEndpointUpdate(id="probe", name="probe", api_key=key,
            base_url="https://new.example/v1", model="new-model", make_default=make_default))

    assert error.value.status_code == 403
    assert plane.profile("default")["values"] == original
    assert (plane.home / ".env").read_bytes() == before
    assert get_env_value(slot) == "original-endpoint-secret"
    assert not (plane.home / "config.yaml").exists()


@pytest.mark.parametrize("schedule", ["locked", "late-poll", "late-retry"])
def test_locked_endpoint_delete_keeps_credential_pool_and_secret(plane, monkeypatch, schedule):
    from fastapi import HTTPException
    from hermes_cli.auth import _load_auth_store, write_credential_pool
    from hermes_cli.config import get_env_value

    config_env, slot, original = _endpoint(plane, monkeypatch)
    row = {"id": "custom-owned", "source": "config:probe", "auth_type": "api_key",
           "access_token": "pool-secret", "base_url": "https://old.example/v1"}
    write_credential_pool("probe", [row])
    pool_before = deepcopy(_load_auth_store()["credential_pool"])
    _lock_on_save(plane, monkeypatch, config_env, schedule, "providers")

    with pytest.raises(HTTPException) as error:
        config_env.delete_custom_endpoint("probe")

    assert error.value.status_code == 403
    assert plane.profile("default")["values"] == original
    assert get_env_value(slot) == "original-endpoint-secret"
    assert _load_auth_store()["credential_pool"] == pool_before


@pytest.mark.parametrize("key", ["accepted-replacement", ""])
def test_unlocked_endpoint_edit_and_delete_commit_credentials_with_remote_config(plane, monkeypatch, key):
    from hermes_cli.auth import _load_auth_store, write_credential_pool
    from hermes_cli.config import get_env_value
    from hermes_cli.web_models import CustomEndpointUpdate

    config_env, slot, _ = _endpoint(plane, monkeypatch)
    response = config_env.upsert_custom_endpoint(CustomEndpointUpdate(id="probe", name="probe", api_key=key,
        base_url="https://new.example/v1", model="new-model", make_default=True))
    assert response["ok"] is True
    assert get_env_value(slot) == (key or None)
    stored = plane.profile("default")["values"]
    assert stored["providers"]["probe"]["model"] == "new-model"
    assert stored["model"]["default"] == "new-model"
    write_credential_pool("probe", [{"id": "owned", "source": "config:probe", "auth_type": "api_key",
        "access_token": "pool-secret", "base_url": "https://new.example/v1"}])

    deleted = config_env.delete_custom_endpoint("probe")

    assert deleted["ok"] is True and deleted["endpoints"] == []
    assert not plane.profile("default")["values"].get("providers", {}).get("probe")
    assert get_env_value(slot) is None
    assert _load_auth_store()["credential_pool"]["probe"] == []
    assert not (plane.home / "config.yaml").exists()


def test_file_endpoint_commit_failure_restores_config_env_and_account_bytes(tmp_path, monkeypatch):
    from hermes_cli.auth import _auth_file_path, write_credential_pool
    from hermes_cli.config import custom_endpoint_key_env, get_env_value, save_env_value
    from hermes_cli.web_models import CustomEndpointUpdate
    from hermes_cli.web_routers import config_env

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    config_path = tmp_path / "config.yaml"
    config_path.write_text("# retained comment\nproviders: {}\n", encoding="utf-8")
    slot = custom_endpoint_key_env("probe")
    save_env_value(slot, "original-local-secret")
    write_credential_pool("unrelated", [{"id": "keep-account", "source": "manual", "auth_type": "api_key",
        "access_token": "unrelated-account-secret"}])
    before = {path: path.read_bytes() for path in (config_path, tmp_path / ".env", _auth_file_path())}
    save = config_env.save_config

    def fail_after_write(config):
        save(config)
        raise OSError("local commit failed")

    monkeypatch.setattr(config_env, "save_config", fail_after_write)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        config_env.upsert_custom_endpoint(CustomEndpointUpdate(id="probe", name="probe", api_key="new-local-secret",
            base_url="https://new.example/v1", model="new-model"))

    assert error.value.status_code == 500
    assert {path: path.read_bytes() for path in before} == before
    assert get_env_value(slot) == "original-local-secret"


def test_file_endpoint_delete_failure_restores_owned_and_unrelated_accounts(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from hermes_cli.auth import _auth_file_path, write_credential_pool
    from hermes_cli.config import custom_endpoint_key_env, get_env_value, save_env_value
    from hermes_cli.web_routers import config_env

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    slot = custom_endpoint_key_env("probe")
    config_path = tmp_path / "config.yaml"
    config_path.write_text(f"# keep all bytes\nproviders:\n  probe:\n    name: probe\n"
        f"    model: old\n    base_url: https://old.example/v1\n    key_env: {slot}\n", encoding="utf-8")
    save_env_value(slot, "original-local-secret")
    write_credential_pool("probe", [{"id": "owned", "source": "config:probe", "auth_type": "api_key",
        "access_token": "owned-secret", "base_url": "https://old.example/v1"}])
    write_credential_pool("unrelated", [{"id": "keep-account", "source": "manual", "auth_type": "api_key",
        "access_token": "unrelated-account-secret"}])
    before = {path: path.read_bytes() for path in (config_path, tmp_path / ".env", _auth_file_path())}
    monkeypatch.setattr(config_env, "save_config", lambda cfg: (_ for _ in ()).throw(OSError("commit refused")))

    with pytest.raises(HTTPException) as error:
        config_env.delete_custom_endpoint("probe")

    assert error.value.status_code == 500
    assert {path: path.read_bytes() for path in before} == before
    assert get_env_value(slot) == "original-local-secret"


@pytest.mark.parametrize("operation", ["replace", "clear", "delete"])
@pytest.mark.parametrize("injected", [True, False])
def test_endpoint_refusal_preserves_launch_injected_secret_and_absence(plane, monkeypatch, operation, injected):
    import os

    from fastapi import HTTPException
    from hermes_cli.config import get_env_value, remove_env_value, save_env_value
    from hermes_cli.web_models import CustomEndpointUpdate
    from tui_gateway.launch_profile_policy import launch_secret_scope

    config_env, slot, original = _endpoint(plane, monkeypatch)
    remove_env_value(slot)
    if injected:
        monkeypatch.setenv(slot, "launch-injected-secret")
    else:
        monkeypatch.delenv(slot, raising=False)
    save_env_value("UNRELATED_PROVIDER_TOKEN", "dotenv-unrelated")
    monkeypatch.setenv("UNRELATED_PROVIDER_TOKEN", "injected-unrelated")
    before = (plane.home / ".env").read_bytes()
    plane.upper_locks = [{"path": "providers", "level": "tenant"}]

    with pytest.raises(HTTPException) as error:
        if operation == "delete":
            config_env.delete_custom_endpoint("probe")
        else:
            config_env.upsert_custom_endpoint(CustomEndpointUpdate(id="probe", name="probe",
                api_key="replacement" if operation == "replace" else "",
                base_url="https://new.example/v1", model="new-model"))

    assert error.value.status_code == 403
    assert plane.profile("default")["values"] == original
    assert (plane.home / ".env").read_bytes() == before
    expected = "launch-injected-secret" if injected else None
    assert os.environ.get(slot) == expected
    assert get_env_value(slot) == expected
    assert launch_secret_scope(plane.home).get(slot) == expected
    assert os.environ["UNRELATED_PROVIDER_TOKEN"] == "injected-unrelated"


def test_endpoint_refusal_preserves_routed_source_scope_and_launch_environment(profile_plane, monkeypatch):
    import os

    from agent.secret_scope import current_secret_scope
    from fastapi import HTTPException
    from hermes_cli import env_loader
    from hermes_cli.config import custom_endpoint_key_env
    from hermes_cli.web_models import CustomEndpointUpdate
    from hermes_cli.web_routers import config_env

    named = profile_plane.home / "profiles" / "routed"
    named.mkdir(parents=True)
    slot = custom_endpoint_key_env("probe")
    (named / ".env").write_text("UNRELATED_PROVIDER_TOKEN=dotenv-unrelated\n", encoding="utf-8")
    original = {"providers": {"probe": {"name": "probe", "base_url": "https://old.example/v1",
                "model": "old-model", "key_env": slot}}}
    profile_plane.profile("routed").update(values=deepcopy(original), version=1)
    profile_plane.upper_locks = [{"path": "providers", "level": "tenant"}]
    supplied = {slot: "routed-source-secret", "UNRELATED_PROVIDER_TOKEN": "source-unrelated"}
    monkeypatch.setattr(env_loader, "hydrate_profile_secret_sources", lambda home: supplied)
    monkeypatch.setattr(env_loader, "get_secret_source_values", lambda home: supplied if home == named else {})
    monkeypatch.setenv(slot, "launch-only-secret")
    monkeypatch.setenv("UNRELATED_PROVIDER_TOKEN", "launch-unrelated")
    scopes = []
    write = config_env._write_custom_endpoint

    def observe_write(cfg, body):
        scopes.append(current_secret_scope())
        return write(cfg, body)

    monkeypatch.setattr(config_env, "_write_custom_endpoint", observe_write)
    with pytest.raises(HTTPException) as error:
        config_env.upsert_custom_endpoint(CustomEndpointUpdate(id="probe", name="probe", api_key="replacement",
            base_url="https://new.example/v1", model="new-model"), profile="routed")

    assert error.value.status_code == 403
    assert profile_plane.profile("routed")["values"] == original
    assert scopes[0][slot] == "routed-source-secret"
    assert scopes[0]["UNRELATED_PROVIDER_TOKEN"] == "source-unrelated"
    assert os.environ[slot] == "launch-only-secret"
    assert os.environ["UNRELATED_PROVIDER_TOKEN"] == "launch-unrelated"
    assert (named / ".env").read_text(encoding="utf-8") == "UNRELATED_PROVIDER_TOKEN=dotenv-unrelated\n"
