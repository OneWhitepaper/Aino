"""Profile configuration evidence for provider discovery and credential adoption."""

from __future__ import annotations

import logging
from functools import partial
from typing import Any

logger = logging.getLogger("hermes_cli.auth")


def _active_provider_is(normalized: str) -> bool:
    from hermes_cli.auth import _load_auth_store
    active = (_load_auth_store().get("active_provider") or "").strip().lower()
    return bool(active) and active == normalized


def _slot_selects(slot: Any, normalized: str) -> bool:
    return isinstance(slot, dict) and (slot.get("provider") or "").strip().lower() == normalized


def _config_selects_provider(normalized: str, *, include_defaults: bool = True) -> bool:
    """config.yaml ``model.provider``, or a MoA advisor/aggregator slot naming the provider.

    MoA presets are explicit model selections too: ``provider: anthropic`` in a MoA slot opts into
    Anthropic credentials for that slot even when the main model is another provider; otherwise
    Claude Code OAuth entries get pruned by ``load_pool("anthropic")`` and MoA advisors fail with
    "no ANTHROPIC_API_KEY" while the picker says Anthropic is logged in."""
    from hermes_cli.config import load_config
    from hermes_cli.config_effective import load_user_config_effective
    cfg = load_config() if include_defaults else load_user_config_effective()
    if _slot_selects(cfg.get("model"), normalized):
        return True
    # ``auxiliary.<task>.provider: copilot`` selects the provider for that task the same way a MoA
    # slot does — without this the seeder treats the credential as merely discovered (#114740).
    aux_cfg = cfg.get("auxiliary")
    if isinstance(aux_cfg, dict) and any(_slot_selects(s, normalized) for s in aux_cfg.values()):
        return True

    def _moa_block_matches(block: Any) -> bool:
        return isinstance(block, dict) and (
            any(_slot_selects(s, normalized) for s in block.get("reference_models") or [])
            or _slot_selects(block.get("aggregator"), normalized))

    moa_cfg = cfg.get("moa")
    if not isinstance(moa_cfg, dict):
        return False
    presets = moa_cfg.get("presets")
    presets = presets.values() if isinstance(presets, dict) else ()
    return _moa_block_matches(moa_cfg) or any(_moa_block_matches(p) for p in presets)


def _explicit_pool_entry_present(normalized: str, *, include_process_env: bool = True) -> bool:
    """Pool rows from EXPLICIT Hermes flows (manual add / device-code / PKCE) or live env keys;
    ambient borrowed sources (gh_cli / claude_code / qwen-cli) are deliberately excluded."""
    from hermes_cli.auth import read_credential_pool
    return any(_pool_entry_is_explicit(entry, include_process_env=include_process_env)
               for entry in read_credential_pool(normalized))


# Set by Claude Code itself, not by the user explicitly configuring anthropic in Hermes.
_IMPLICIT_ENV_VARS = frozenset({"CLAUDE_CODE_OAUTH_TOKEN"})
_EXPLICIT_POOL_SOURCES = frozenset({"device_code", "loopback_pkce", "hermes_pkce", "manual"})
_VERTEX_PROVIDER_IDS = ("vertex", "google-vertex", "vertex-ai", "gcp-vertex", "vertexai")


def _env_secret(name: str, *, include_process_env: bool = True) -> bool:
    """A usable credential; chat discovery requires a profile or managed .env source.

    Resolution still uses the credential reader so an explicit secret reference
    can resolve through the owning scope without admitting unrelated shell keys.
    """
    from hermes_cli.auth import has_usable_secret
    from hermes_cli.config import get_env_value_prefer_dotenv, load_env
    from hermes_cli.managed_scope import load_managed_env
    if not include_process_env and not (load_managed_env().get(name) or load_env().get(name)):
        return False
    return has_usable_secret(get_env_value_prefer_dotenv(name) or "")


def _explicit_env_credentials_present(normalized: str, *, include_process_env: bool = True) -> bool:
    """True when the user has pasted an explicit credential env var for *normalized*.

    Falls back to the models.dev ``ProviderDef`` (same shape) for non-registry providers such as
    openrouter. AWS SDK providers are checked via explicit env vars only — NOT boto3's chain, so
    ambient EC2 IMDS / SSO profiles never auto-surface."""
    from hermes_cli.auth import PROVIDER_REGISTRY
    secret = partial(_env_secret, include_process_env=include_process_env)
    pconfig = PROVIDER_REGISTRY.get(normalized)
    if pconfig is None:
        from hermes_cli.providers import get_provider
        pconfig = get_provider(normalized)
        if not pconfig:
            return False
    if pconfig.auth_type == "api_key":
        return any(secret(v) for v in pconfig.api_key_env_vars if v not in _IMPLICIT_ENV_VARS)
    if pconfig.auth_type == "aws_sdk":
        return secret("AWS_BEARER_TOKEN_BEDROCK") or (
            secret("AWS_ACCESS_KEY_ID") and secret("AWS_SECRET_ACCESS_KEY"))
    return False


def _pool_entry_is_explicit(entry: Any, *, include_process_env: bool = True) -> bool:
    """True for pool rows the user created via an explicit Hermes flow (or a still-live env key)."""
    if not isinstance(entry, dict):
        return False
    source = str(entry.get("source") or "").strip().lower()
    if source.startswith("env:"):
        # A stale env-seeded entry survives in auth.json after the user deletes the env var: only
        # count it when the referenced var still resolves to a usable secret NOW.
        # See #55790.
        env_var = entry.get("source", "").split(":", 1)[1].strip()
        return bool(env_var and _env_secret(env_var, include_process_env=include_process_env))
    return bool(source) and (source in _EXPLICIT_POOL_SOURCES or source.startswith("manual:"))


def _keyless_provider_has_explicit_config(normalized: str) -> bool:
    """Vertex / Bedrock count as explicit when Hermes-scoped routing config is present.

    Uses has_explicit_vertex_config(), NOT has_vertex_credentials(): the latter also counts an
    ambient GOOGLE_APPLICATION_CREDENTIALS path (commonly set for unrelated GCP work). Only
    Hermes-scoped signals (VERTEX_PROJECT_ID / vertex.project_id / VERTEX_CREDENTIALS_PATH) count
    here."""
    if normalized in _VERTEX_PROVIDER_IDS:
        from agent.vertex_adapter import has_explicit_vertex_config
        return bool(has_explicit_vertex_config())
    if normalized == "bedrock":
        from hermes_cli.config import load_config
        bedrock_cfg = load_config().get("bedrock")
        return isinstance(bedrock_cfg, dict) and bool(str(bedrock_cfg.get("region") or "").strip())
    return False


def is_provider_explicitly_configured(provider_id: str, *, include_process_env: bool = True) -> bool:
    """True only if the user explicitly configured this provider: auth.json ``active_provider``,
    config.yaml ``model.provider`` / MoA slots, a pasted provider env var, a pool entry from a
    Hermes-initiated flow, or Hermes-scoped routing config for keyless cloud-SDK providers. Ambient
    borrowed credentials (gh CLI, qwen-cli, ~/.claude/.credentials.json) never count.
    Chat catalogs pass ``include_process_env=False`` so inherited shell keys and
    their auto-seeded pool entries do not imply saved application configuration."""
    normalized = (provider_id or "").strip().lower()
    checks = (
        (_active_provider_is, True),
        (partial(_config_selects_provider, include_defaults=include_process_env), True),
        (partial(_explicit_env_credentials_present, include_process_env=include_process_env), False),
        (partial(_explicit_pool_entry_present, include_process_env=include_process_env), True),
        (_keyless_provider_has_explicit_config, True),
    )
    for check, best_effort in checks:
        try:
            if check(normalized):
                return True
        except Exception as exc:
            if not best_effort:
                raise
            logger.debug("explicit-config check %s failed for %s: %s", check, provider_id, exc)
    return False
