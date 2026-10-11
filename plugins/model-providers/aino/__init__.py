"""Aino platform provider profile — first-party managed credentials."""

from providers import register_provider
from providers.base import ProviderProfile

class AinoProfile(ProviderProfile):
    """Aino platform — managed credentials bound per session, never from env/config."""

    def get_model_context_length(self, model: str, *, base_url: str = "", api_key=None) -> int | None:
        from agent.auxiliary_billing_scope import ManagedCredential

        if (isinstance(api_key, ManagedCredential) and model == api_key.model
                and base_url.rstrip("/") == api_key.base_url.rstrip("/")
                and api_key.get_context_window is not None):
            return api_key.get_context_window()
        return None

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
