"""Aino platform provider profile — first-party managed credentials."""

from providers import register_provider
from providers.base import ProviderProfile

class AinoProfile(ProviderProfile):
    """Aino platform — managed credentials bound per session, never from env/config."""

    def fetch_models(
        self, *, api_key: str | None = None, base_url: str | None = None, timeout: float = 8.0
    ) -> list[str] | None:
        """Aino provider does not support fetch_models — catalog comes from desktop bridge."""
        return None


aino = AinoProfile(
    name="aino",
    aliases=(),
    display_name="Aino",
    description="Aino platform models with session-managed credentials",
    api_mode="chat_completions",  # Default; actual mode comes from binding
    env_vars=(),  # No environment credentials
    base_url="",  # Actual base_url comes from binding
    auth_type="session_managed",
    supports_health_check=False,
    default_aux_model="",  # No default auxiliary model
)

register_provider(aino)
