"""Credential cleanup for explicitly deleted custom endpoints."""

from typing import Any
from urllib.parse import urlparse

from hermes_cli.config import custom_endpoint_key_env, get_compatible_custom_providers
from hermes_cli.providers import custom_provider_aliases, is_builtin_provider_id


def _references_env(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return any(_references_env(child, key) for child in value.values())
    if isinstance(value, list):
        return any(_references_env(child, key) for child in value)
    return isinstance(value, str) and (value == key or f"${{{key}}}" in value)


def endpoint_credential_slots(provider_key: str, entry: dict[str, Any], remaining: dict[str, Any]) -> set[str]:
    """Only Hermes-minted, now-unreferenced slots belong to the removed endpoint.

    Older CLI setup keyed its secret by host:port; a hand-written key_env can be
    shared with other integrations and is deliberately outside this deletion.
    """
    slots = {custom_endpoint_key_env(provider_key)}
    url = urlparse(str(entry.get("base_url") or entry.get("url") or entry.get("api") or ""))
    if url.hostname:
        identity = f"{url.hostname}_{url.port}" if url.port else url.hostname
        legacy_slot = custom_endpoint_key_env(identity)
        if entry.get("key_env") == legacy_slot:
            slots.add(legacy_slot)
    return {key for key in slots if not _references_env(remaining, key)}


def _owned_pool_row(row: Any, *, url: str, name: str, slots: set[str], official: bool) -> bool:
    if not isinstance(row, dict):
        return False
    source = str(row.get("source") or "")
    row_url = str(row.get("base_url") or "").rstrip("/")
    if source == f"config:{name}":
        return not row_url or row_url == url
    if source in {"model_config", *(f"env:{key}" for key in slots)}:
        return row_url == url
    # A custom pool can contain manually added accounts; official pools with
    # the same slug also hold independent accounts, even at the same URL.
    return not official and bool(url) and row_url == url


def clear_endpoint_credential_pools(
    provider_key: str, entry: dict[str, Any], remaining: dict[str, Any], slots: set[str],
) -> None:
    """Prune endpoint-owned rows from this profile, never the global auth fallback."""
    from hermes_cli.auth import _auth_store_lock, _load_auth_store, _save_auth_store

    name = str(entry.get("name") or provider_key)
    url = str(entry.get("base_url") or entry.get("url") or entry.get("api") or "").rstrip("/")
    aliases = custom_provider_aliases(name, provider_key)
    shared = set()
    for other in get_compatible_custom_providers(remaining):
        other_url = str(other.get("base_url") or other.get("url") or other.get("api") or "").rstrip("/")
        # A shared label alone does not keep a deleted route's credential alive.
        if other_url == url:
            shared.update(custom_provider_aliases(str(other.get("name") or ""), str(other.get("provider_key") or "")))
    with _auth_store_lock():
        store = _load_auth_store()
        pools = store.get("credential_pool")
        if not isinstance(pools, dict):
            return
        changed = False
        for identity in aliases - shared:
            rows = pools.get(identity)
            if not isinstance(rows, list):
                continue
            official = is_builtin_provider_id(identity)
            kept = [row for row in rows if not _owned_pool_row(row, url=url, name=name, slots=slots, official=official)]
            if len(kept) != len(rows):
                pools[identity] = kept
                changed = True
        if changed:
            _save_auth_store(store)
