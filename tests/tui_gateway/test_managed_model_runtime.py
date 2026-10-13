"""Test managed model runtime resolution and Agent initialization."""
import time
from datetime import datetime, timedelta, UTC

import pytest

from tui_gateway.managed_model_runtime import (
    ManagedModelBinding,
    ManagedModelOwner,
    resolve_managed_runtime,
    persisted_managed_model_metadata,
)


@pytest.fixture
def valid_binding():
    """Create a valid managed model binding for testing."""
    owner = ManagedModelOwner(
        platform_origin="https://api.agentera.com.cn",
        user_id="test-user-123"
    )
    expires_at = datetime.now(UTC) + timedelta(minutes=10)

    return ManagedModelBinding(
        session_id="test-session",
        owner=owner,
        model_id="fixture-model-a",
        model="claude-sonnet-4-20250514",
        api_mode="anthropic_messages",
        capabilities={"tools": True, "vision": False, "reasoning": True},
        credential_id="cred-123",
        api_key="test-secret-key",
        base_url="https://api.agentera.com.cn/v1",
        expires_at=expires_at,
        binding_revision=1,
    )


def test_resolve_managed_runtime_returns_valid_runtime(valid_binding):
    """resolve_managed_runtime returns AIAgent-compatible runtime kwargs."""
    result = resolve_managed_runtime(valid_binding, now=time.time())

    assert result.get("provider") == "aino"
    assert result.get("model") == "claude-sonnet-4-20250514"
    assert result.get("base_url") == "https://api.agentera.com.cn/v1"
    assert result.get("api_key") == "test-secret-key"
    assert result.get("api_mode") == "anthropic_messages"
    assert "credential_expired" not in result


def test_resolve_managed_runtime_detects_expired_credential(valid_binding):
    """resolve_managed_runtime returns credential_expired for past expiry."""
    expired_binding = ManagedModelBinding(
        session_id=valid_binding.session_id,
        owner=valid_binding.owner,
        model_id=valid_binding.model_id,
        model=valid_binding.model,
        api_mode=valid_binding.api_mode,
        capabilities=valid_binding.capabilities,
        credential_id=valid_binding.credential_id,
        api_key=valid_binding.api_key,
        base_url=valid_binding.base_url,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
        binding_revision=valid_binding.binding_revision,
    )

    result = resolve_managed_runtime(expired_binding, now=time.time())
    assert result.get("credential_expired") is True
    assert "api_key" not in result


def test_resolve_managed_runtime_maps_chat_completions_api_mode(valid_binding):
    """resolve_managed_runtime maps chat_completions to AIAgent runtime."""
    binding = ManagedModelBinding(
        session_id=valid_binding.session_id,
        owner=valid_binding.owner,
        model_id=valid_binding.model_id,
        model="gpt-4",
        api_mode="chat_completions",
        capabilities=valid_binding.capabilities,
        credential_id=valid_binding.credential_id,
        api_key=valid_binding.api_key,
        base_url=valid_binding.base_url,
        expires_at=valid_binding.expires_at,
        binding_revision=valid_binding.binding_revision,
    )

    result = resolve_managed_runtime(binding, now=time.time())
    assert result.get("api_mode") == "chat_completions"


def test_resolve_managed_runtime_maps_responses_to_codex_responses(valid_binding):
    """resolve_managed_runtime maps responses to codex_responses for Codex models."""
    binding = ManagedModelBinding(
        session_id=valid_binding.session_id,
        owner=valid_binding.owner,
        model_id=valid_binding.model_id,
        model="o4",
        api_mode="responses",
        capabilities=valid_binding.capabilities,
        credential_id=valid_binding.credential_id,
        api_key=valid_binding.api_key,
        base_url=valid_binding.base_url,
        expires_at=valid_binding.expires_at,
        binding_revision=valid_binding.binding_revision,
    )

    result = resolve_managed_runtime(binding, now=time.time())
    assert result.get("api_mode") == "codex_responses"
    assert result.get("provider") == "aino"  # Must remain aino, not openai-codex


def test_persisted_managed_model_metadata_excludes_secrets(valid_binding):
    """persisted_managed_model_metadata returns only identifiers, never credentials."""
    metadata = persisted_managed_model_metadata(valid_binding)

    assert metadata.get("model_source") == "aino"
    assert metadata.get("model_id") == "fixture-model-a"
    assert metadata.get("api_mode") == "anthropic_messages"
    assert metadata.get("platform_owner") == {
        "platform_origin": "https://api.agentera.com.cn",
        "user_id": "test-user-123",
    }

    # Secrets must not be in persisted metadata
    assert "api_key" not in metadata
    assert "credential_id" not in metadata
    assert "base_url" not in metadata
    assert "expires_at" not in metadata


def test_persisted_managed_model_metadata_structure(valid_binding):
    """persisted_managed_model_metadata structure matches session DB schema."""
    metadata = persisted_managed_model_metadata(valid_binding)

    # Structure must be dict with expected keys
    assert isinstance(metadata, dict)
    assert isinstance(metadata["platform_owner"], dict)
    assert "platform_origin" in metadata["platform_owner"]
    assert "user_id" in metadata["platform_owner"]
