"""In-memory custom MCP installs through the existing connection-card backend."""

from __future__ import annotations

import math
import re
from copy import deepcopy
from typing import Any
from urllib.parse import urlsplit


_FIELDS = frozenset({"url", "command", "args", "auth", "timeout", "transport", "env"})


def _invalid(message: str) -> ValueError:
    error = ValueError(message)
    error.failure_class = "config_invalid"
    return error


def _validate_url(cfg: dict[str, Any]) -> None:
    if not isinstance(cfg["url"], str):
        raise _invalid("custom MCP URL must be a string")
    url = urlsplit(cfg["url"])
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise _invalid("custom MCP URL must be HTTP(S) without embedded credentials")
    if url.query or url.fragment or "args" in cfg:
        raise _invalid("custom MCP URLs cannot include query credentials, fragments, or stdio args")


def _validate_transport(cfg: dict[str, Any]) -> None:
    remote = bool(cfg.get("url"))
    if remote == bool(cfg.get("command")):
        raise _invalid("custom MCP configuration needs exactly one URL or command")
    if remote:
        _validate_url(cfg)
    elif not isinstance(cfg["command"], str) or not cfg["command"].strip():
        raise _invalid("custom MCP command must be a nonempty string")
    args = cfg.get("args", [])
    if not isinstance(args, list) or any(not isinstance(arg, str) for arg in args):
        raise _invalid("custom MCP args must be a list of strings")
    transport = cfg.get("transport", "http" if remote else "stdio")
    if transport != ("http" if remote else "stdio"):
        raise _invalid("custom MCP transport must match its URL or command")
    auth = cfg.get("auth", "none")
    if auth not in ("none", "oauth") or (not remote and auth != "none"):
        raise _invalid("custom MCP auth must be none, or oauth for an HTTP server")


def validate_config(name: str, config: Any) -> dict[str, Any]:
    """Validate both the card-safe shape and Hermes's existing command policy."""
    from hermes_cli.config import validate_env_var_name_for_write
    from hermes_cli.mcp_security import validate_mcp_server_entry

    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", name):
        raise _invalid("custom MCP names must contain lowercase letters, digits, underscores or hyphens")
    if not isinstance(config, dict) or set(config) - _FIELDS:
        raise _invalid("unsupported custom MCP configuration fields")
    cfg = deepcopy(config)
    _validate_transport(cfg)
    timeout = cfg.get("timeout", 30)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise _invalid("custom MCP timeout must be a positive finite number")
    env = cfg.get("env", {})
    if not isinstance(env, dict):
        raise _invalid("custom MCP env must map key names to references")
    for key, value in env.items():
        if not isinstance(key, str) or value != "${" + key + "}":
            raise _invalid("custom MCP env accepts only matching ${KEY} references; enter secrets in the approval card")
        validate_env_var_name_for_write(key)
    issues = validate_mcp_server_entry(name, cfg)
    if issues:
        raise _invalid("; ".join(issues))
    return cfg


def ensure_new_server(name: str) -> None:
    from hermes_cli.config import load_config
    from tools.mcp_tool_config import _load_mcp_config

    servers = load_config().get("mcp_servers") or {}
    if name in servers or name in _load_mcp_config():
        raise _invalid(f"MCP server '{name}' is already configured; use enable or authorize")


def public_config(cfg: dict[str, Any]) -> dict[str, Any]:
    shown = {key: deepcopy(value) for key, value in cfg.items() if key != "env"}
    if cfg.get("env"):
        shown["env_keys"] = sorted(cfg["env"])
    return shown


def _persist_install(name: str, cfg: dict[str, Any], env: dict[str, str]) -> None:
    """Keep the configuration and card credentials together if either write fails."""
    from hermes_cli import config as config_module
    from hermes_cli.mcp_config import _save_mcp_server
    from tools.connectors.mcp import _save_env
    from utils import atomic_write_bytes

    for key in env:
        config_module.require_env_writable(key, "set")
    config_path, env_path = config_module.get_config_path(), config_module.get_env_path()
    with config_module._CONFIG_LOCK, config_module._env_write_lock(env_path):
        before = {path: path.read_bytes() if path.exists() else None for path in (config_path, env_path)}
        old_values = {key: config_module.get_env_value(key) for key in env}
        try:
            if not _save_mcp_server(name, cfg):
                raise _invalid(f"'{name}' was rejected: suspicious command/args configuration")
            _save_env(env)
        except Exception:
            for path, data in before.items():
                if data is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write_bytes(path, data)
            for key, value in old_values.items():
                config_module._publish_env_value(key, value)
            config_module.invalidate_env_cache()
            for cache in (config_module._LOAD_CONFIG_CACHE, config_module._RAW_CONFIG_CACHE,
                          config_module._LAST_EXPANDED_CONFIG_BY_PATH):
                cache.pop(str(config_path), None)
            raise


class CustomMCPBackend:
    """Route custom targets while retaining catalog installation for bundled entries."""

    def __init__(self, configs: dict[str, dict[str, Any]], catalog: Any):
        self.configs = {name: validate_config(name, cfg) for name, cfg in configs.items()}
        self.catalog = catalog
        self.operation = None
        self.cancelled: set[str] = set()
        self.committed: set[str] = set()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.catalog, name)

    def bind_operation(self, operation) -> None:
        self.operation = operation

    def required_env(self, name: str) -> list[dict[str, Any]]:
        if name not in self.configs:
            return self.catalog.required_env(name)
        from hermes_cli.config import get_env_value

        return [{"name": key, "prompt": f"Enter {key}", "required": True,
                 "secret": True, "default": ""}
                for key in self.configs[name].get("env", {}) if not get_env_value(key)]

    def installs_with_oauth(self, name: str) -> bool:
        if name not in self.configs:
            return self.catalog.installs_with_oauth(name)
        return self.configs[name].get("auth") == "oauth"

    def _approved_config(self, name: str, env: dict[str, str]) -> dict[str, Any]:
        cfg = validate_config(name, self.configs[name])
        if set(env) - set(cfg.get("env", {})):
            raise _invalid(f"'{name}' received undeclared environment variables")
        ensure_new_server(name)
        return cfg

    def _commit(self, name: str, cfg: dict[str, Any], env: dict[str, str]) -> None:
        from hermes_cli.web_routers._common import config_write_scope
        from tools.connectors.mcp_oauth import AttemptCanceled

        with config_write_scope(None):
            if name in self.cancelled or (self.operation is not None and self.operation.settled):
                raise AttemptCanceled("custom MCP installation canceled before saving")
            ensure_new_server(name)
            _persist_install(name, cfg, env)
            self.committed.add(name)

    def cancel_install(self, name: str) -> bool:
        from tools.connectors.mcp_oauth import _COMMIT_GUARD

        with _COMMIT_GUARD:
            if name in self.committed:
                return True
            self.cancelled.add(name)
            return False

    def install(self, name: str, env: dict[str, str]) -> list[str]:
        if name not in self.configs:
            return self.catalog.install(name, env)
        from agent.secret_scope import (
            current_secret_scope, current_secret_scope_home, reset_secret_scope, set_secret_scope)
        from hermes_cli.mcp_config import _probe_single_server
        from tools.connectors.mcp_oauth import _COMMIT_GUARD

        cfg = self._approved_config(name, env)
        token = set_secret_scope({**dict(current_secret_scope() or {}), **env},
                                 profile_home=current_secret_scope_home())
        try:
            tools = [str(tool[0]) for tool in (_probe_single_server(name, cfg) or [])]
        finally:
            reset_secret_scope(token)
        with _COMMIT_GUARD:
            self._commit(name, cfg, env)
        return tools

    def start_install_oauth(self, name: str, env: dict[str, str]) -> Any:
        if name not in self.configs:
            return self.catalog.start_install_oauth(name, env)
        from tools.connectors import mcp_oauth

        cfg = self._approved_config(name, env)
        return mcp_oauth.start(name, cfg=cfg, env=env,
                               commit_config=lambda: self._commit(name, cfg, env))
