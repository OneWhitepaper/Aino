"""Session-bound inference authority and request correlation, not model context."""

from contextvars import ContextVar
from dataclasses import dataclass, field, replace
import json
from typing import Callable
from urllib.parse import urlsplit
from uuid import uuid4

from agent.usage_correlation import TurnCallTracker


@dataclass(frozen=True)
class BillingScope:
    source: str
    user_id: str | None
    session_id: str
    turn_id: str
    purpose: str
    calls: TurnCallTracker = field(default_factory=TurnCallTracker, repr=False, compare=False)


billing_scope: ContextVar[BillingScope | None] = ContextVar("billing_scope", default=None)
_CREDENTIAL_UNSET = object()
_DETAILED_TASKS = frozenset({"session_summary", "approval", "mcp", "tts_audio_tags", "side_question"})
_PURPOSES = {"title_generation": "title", "compression": "compression", "vision": "vision",
             "delegation": "delegation", "chat": "chat", **{task: task for task in _DETAILED_TASKS}}


@dataclass(frozen=True, eq=False)
class ManagedCredential:
    get_key: Callable[[], str] = field(repr=False)
    user_id: str
    session_id: str
    model: str
    base_url: str
    api_mode: str
    vision: bool
    scope: BillingScope | None = None
    on_override: Callable[[str, str], None] | None = field(default=None, repr=False)

    def __call__(self) -> str:
        return self.get_key()

    def for_task(self, task: str | None):
        scope = self.scope or billing_scope.get()
        if scope is None:
            scope = BillingScope("aino", self.user_id, self.session_id, str(uuid4()), "chat")
        self.validate_scope(scope)
        return replace(self, scope=replace(scope, purpose=_PURPOSES.get(task, "other_auxiliary")))

    def validate_scope(self, scope: BillingScope):
        if (scope.source, scope.user_id, scope.session_id) != ("aino", self.user_id, self.session_id):
            raise RuntimeError("managed_billing_scope_mismatch")

    def prepare_request(self, request):
        target, allowed = urlsplit(str(request.url)), urlsplit(self.base_url)
        if ((target.scheme, target.netloc) != (allowed.scheme, allowed.netloc)
                or not target.path.startswith(allowed.path.rstrip("/") + "/")):
            raise RuntimeError("managed_credential_destination_mismatch")
        if request.method == "POST":
            body = json.loads(request.content)
            if not isinstance(body, dict) or body.get("model") != self.model:
                raise RuntimeError("managed_model_identity_mismatch")
        scope = self.scope or billing_scope.get()
        if scope is None:
            raise RuntimeError("managed_billing_scope_missing")
        self.validate_scope(scope)
        # Resolve again at dispatch: SDK retries and redirected requests are separate attempts.
        request.headers["Authorization"] = "Bearer " + self()
        request.headers.pop("x-api-key", None)
        # Keep the original purpose enum compatible with servers predating task detail.
        request.headers.pop("X-Aino-Task", None)
        purpose = scope.purpose
        if purpose in _DETAILED_TASKS:
            request.headers["X-Aino-Task"] = purpose
            purpose = "other_auxiliary"
        call_id = str(uuid4())
        request.headers.update({"X-Aino-Session-Id": scope.session_id,
                                "X-Aino-Turn-Id": scope.turn_id,
                                "X-Aino-Call-Id": call_id,
                                "X-Aino-Purpose": purpose})
        scope.calls.record(call_id, scope.purpose)


def record_model_call_source(*, credential=_CREDENTIAL_UNSET, provider: str | None = None) -> None:
    """Record only the safe fact that a successful call ran outside Aino.

    Main calls pass their actual runtime credential; auxiliary calls pass the
    concrete provider selected at dispatch. Provider names, endpoints, keys,
    and cost estimates never enter reply metadata.
    """
    scope = billing_scope.get()
    if scope is None:
        return
    if credential is not _CREDENTIAL_UNSET:
        outside_aino = not isinstance(credential, ManagedCredential)
    else:
        name = str(provider or "").strip().lower()
        if not name:
            return
        outside_aino = name != "aino"
    if outside_aino:
        scope.calls.record_non_aino_model_call()


def configure_managed_http(kwargs: dict, credential, *, async_mode: bool = False):
    """Attach to the SDK's own HTTP client, preserving pooling and existing hooks."""
    if not isinstance(credential, ManagedCredential):
        return
    import httpx
    if "http_client" not in kwargs:
        kwargs["http_client"] = httpx.AsyncClient() if async_mode else httpx.Client()
    client = kwargs["http_client"]
    if async_mode:
        async def prepare(request):
            credential.prepare_request(request)
    else:
        prepare = credential.prepare_request
    client.event_hooks["request"].append(prepare)


def managed_runtime(runtime):
    return bool(runtime and (runtime.get("provider") == "aino"
                             or isinstance(runtime.get("api_key"), ManagedCredential)))


def resolve_managed_auxiliary(runtime, provider, model, base_url, api_key, api_mode,
                              task, *, async_mode=False, raw_codex=False):
    """Pin inherited work to its lease. Explicit BYOK keeps its independent route."""
    inherited = provider in (None, "", "auto", "aino") and not base_url and not api_key
    if not managed_runtime(runtime):
        if provider == "aino" or isinstance(api_key, ManagedCredential):
            raise RuntimeError("awaiting_managed_credentials")
        return None
    if not inherited and provider != "aino":
        if isinstance(api_key, ManagedCredential):
            raise RuntimeError("managed_credential_route_mismatch")
        key = runtime.get("api_key")
        if isinstance(key, ManagedCredential) and key.on_override:
            key.on_override(provider or "custom", _PURPOSES.get(task, "other_auxiliary"))
        return None
    key = runtime.get("api_key")
    if not isinstance(key, ManagedCredential):
        raise RuntimeError("awaiting_managed_credentials")
    if ((model and model != key.model) or (base_url and base_url.rstrip("/") != key.base_url.rstrip("/"))
            or (api_key and api_key is not key) or (api_mode and api_mode != key.api_mode)):
        raise RuntimeError("managed_model_identity_mismatch")
    if task == "vision" and not key.vision:
        raise RuntimeError("managed_model_vision_unsupported")
    key = key.for_task(task)
    from agent import auxiliary_client as aux
    if key.api_mode == "anthropic_messages":
        from agent.anthropic_adapter import build_anthropic_client
        client = aux.AnthropicAuxiliaryClient(
            build_anthropic_client(key, key.base_url), key.model, key, key.base_url, is_oauth=False)
    else:
        client = aux._create_openai_client(api_key=key, base_url=key.base_url)
        if key.api_mode == "codex_responses" and not raw_codex:
            client = aux.CodexAuxiliaryClient(client, key.model)
    if async_mode:
        client, _ = aux._to_async_client(client, key.model, is_vision=task == "vision")
    client._hermes_aux_effective_provider = "aino"
    return client, key.model


def constrain_managed_child(kwargs, parent_key):
    if not isinstance(parent_key, ManagedCredential):
        return
    key = kwargs["api_key"]
    if isinstance(key, ManagedCredential):
        if (kwargs["provider"], kwargs["model"], kwargs["base_url"].rstrip("/"), kwargs["api_mode"]) != (
                "aino", key.model, key.base_url.rstrip("/"), key.api_mode):
            raise ValueError("managed delegation must inherit the authorized model and endpoint")
        kwargs["api_key"] = key.for_task("delegation")
    elif kwargs["provider"] == "aino":
        raise ValueError("managed delegation cannot use an unrelated credential")
    elif parent_key.on_override:
        parent_key.on_override(kwargs["provider"], "delegation")
    # An explicit BYOK override must not fall back to its platform parent either.
    kwargs["fallback_model"] = []


def require_persistent_model_authority(provider, *, no_agent=False, from_session=False):
    if no_agent:
        return
    scope = billing_scope.get()
    if provider == "aino" or (from_session and scope and scope.source == "aino" and not provider):
        raise ValueError("Aino desktop credentials expire when disconnected. Configure a persistent BYOK "
                         "model in scheduled-task settings before saving this task.")
