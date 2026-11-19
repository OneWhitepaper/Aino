"""Bind existing Aino model authority to a private Codex app-server process."""

from contextlib import nullcontext
import json
import hashlib
import os
from pathlib import Path
from agent.auxiliary_billing_scope import ManagedCredential
from agent.proxy_bypass import add_loopback_no_proxy
from hermes_constants import get_hermes_home

from .relay import CodeModelRoute, ResponsesRelay
from .replay import ReplayCodec, load_replay_key


def _replay_authority(agent, route):
    credential = route.credential
    if isinstance(credential, ManagedCredential):
        identity = ["aino", credential.user_id, credential.session_id, credential.model_id]
    else:
        secret = credential() if callable(credential) else credential
        identity = [getattr(agent, "provider", None), secret]
    # Bind BYOK tenant headers and key identity without persisting either secret.
    # Managed rotating bearer tokens are intentionally not part of durable identity.
    headers = sorted((key.lower(), value) for key, value in route.headers.items()
                     if not isinstance(credential, ManagedCredential) or key.lower() not in {"authorization", "x-api-key"})
    return hashlib.sha256(json.dumps([identity, headers], separators=(",", ":")).encode()).hexdigest()


class CodeModelBinding:
    def __init__(self, agent):
        self.route = CodeModelRoute.from_agent(agent)
        self.home = get_hermes_home() / "code"
        self.projectless = Path(getattr(agent, "session_cwd", None) or '').parent == self.home / 'workspaces'
        self.home.mkdir(mode=0o700, parents=True, exist_ok=True)
        replay = None
        if self.route.bridged:
            scope = json.dumps([str(self.home.resolve()), getattr(agent, "session_id", None),
                                self.route.base_url, self.route.model, self.route.api_mode,
                                _replay_authority(agent, self.route)], separators=(",", ":"))
            replay = ReplayCodec(load_replay_key(self.home), scope)
        self.relay = ResponsesRelay(self.route, replay=replay)

    def client(self, client_type, **kwargs):
        provider = {"name": "Aino selected model", "base_url": self.relay.base_url, "wire_api": "responses",
                    "env_key": "AINO_CODE_RELAY_TOKEN", "requires_openai_auth": False, "supports_websockets": False}
        if isinstance(self.route.credential, ManagedCredential) or self.route.bridged:
            # A failed/partial paid request may already have executed. Match the
            # existing managed transport's no-automatic-replay contract.
            provider.update(request_max_retries=0, stream_max_retries=0)
        config = {"model_provider": "aino_code", "sandbox_mode": "workspace-write", "approval_policy": "on-request",
                  **{f"model_providers.aino_code.{key}": value for key, value in provider.items()}}
        if self.route.bridged:
            # Provider-hosted search is not an ordinary local function tool.
            config['web_search'] = 'disabled'
        if self.projectless:
            # A developer's data home can sit inside a source checkout. Its
            # parent AGENTS.md/config must not become this chat's project context.
            config['project_root_markers'] = []
        # Codex validates every turn against its process-wide provider. A thread-only
        # override is insufficient; these launch overrides contain no upstream secret.
        args = [part for key, value in config.items() for part in ("-c", f"{key}={json.dumps(value)}")]
        # The model leg is private IPC. Keep external proxy settings intact, but
        # never send the loopback relay token or model input to a system proxy.
        env = add_loopback_no_proxy({key: os.environ[key] for key in ("NO_PROXY", "no_proxy") if key in os.environ})
        env["AINO_CODE_RELAY_TOKEN"] = self.relay.token
        try:
            return client_type(**kwargs, extra_args=args, env=env, inherit_credentials=False)
        except FileNotFoundError:
            raise RuntimeError("Aino Code engine is unavailable. Repair or update Aino to restore its bundled engine.") from None

    def session_options(self, client_type):
        return {"codex_home": str(self.home), "model_provider": "aino_code",
                "client_factory": lambda **kwargs: self.client(client_type, **kwargs)}

    def turn_context(self):
        return self.relay.turn_context()

    def close(self):
        self.relay.close()


def code_turn_context(agent):
    binding = getattr(agent, "_code_model_binding", None)
    return binding.turn_context() if binding is not None else nullcontext()


def code_session_options(agent, client_type):
    if getattr(agent, "execution_mode", "work") != "code":
        return {}
    binding = CodeModelBinding(agent)
    agent._code_model_binding = binding
    return binding.session_options(client_type)


def code_binding_matches(agent):
    if getattr(agent, "execution_mode", "work") != "code":
        return True
    route = CodeModelRoute.from_agent(agent)
    binding = getattr(agent, "_code_model_binding", None)
    return binding is not None and binding.route == route


def close_code_binding(agent):
    binding = getattr(agent, "_code_model_binding", None)
    if binding is not None:
        agent._code_model_binding = None
        binding.close()
