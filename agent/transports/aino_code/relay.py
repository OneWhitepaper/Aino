"""Private Responses transport for a Codex process without upstream credentials.

Codex's env_key is static. This relay applies the existing Aino request credential
hook on every attempt, including requests after a device-key or lease renewal.
"""

import contextvars
import hmac
import json
import logging
import re
import secrets
import threading
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import MappingProxyType
from typing import Callable, Mapping
from urllib.parse import urlsplit

import httpx

from agent.auxiliary_billing_scope import ManagedCredential
from agent.memory_provider import spawn_context_thread
from agent.model_metadata import is_local_endpoint
from agent.anthropic_adapter import anthropic_http_headers

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CodeModelRoute:
    model: str
    base_url: str
    credential: str | Callable[[], str] = field(repr=False)
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)
    api_mode: str = "codex_responses"

    @property
    def bridged(self):
        return self.api_mode in {"chat_completions", "anthropic_messages"}

    @classmethod
    def from_agent(cls, agent):
        mode = getattr(agent, "api_mode", None)
        if mode not in {"responses", "codex_responses", "chat_completions", "anthropic_messages"}:
            raise ValueError("Aino Code supports Responses, Chat Completions, and Anthropic Messages. Select a supported model in settings.")
        base = str(getattr(agent, "base_url", "") or "").strip().rstrip("/")
        url = urlsplit(base)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Aino Code requires a valid HTTP model endpoint without embedded credentials or query parameters.")
        model = str(getattr(agent, "model", "") or "").strip()
        if not model:
            raise ValueError("Select a model before starting Aino Code.")
        headers = dict((getattr(agent, "_client_kwargs", {}) or {}).get("default_headers") or {})
        if mode == "anthropic_messages":
            client = getattr(agent, "_anthropic_client", None)
            owner = str(getattr(agent, "_anthropic_base_url", "") or "").strip().rstrip("/")
            if client is not None and owner == base:
                # Native Anthropic initialization has no OpenAI client kwargs.
                # Reuse its captured tenant headers, not a fresh ambient config lookup.
                headers = {name: value for name, value in (getattr(client, "_custom_headers", {}) or {}).items()
                           if isinstance(value, str)}  # SDK Omit sentinels are not HTTP values.
        return cls(model, base, getattr(agent, "api_key", ""), MappingProxyType(headers), mode)


_REQUEST_HEADERS = frozenset({"accept", "content-type", "openai-beta", "x-codex-beta-features"})
_RESPONSE_HEADERS = frozenset({"content-type", "content-encoding", "retry-after", "x-request-id"})
_HOP_HEADERS = frozenset({"host", "connection", "content-length", "transfer-encoding", "keep-alive",
                          "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"})
_ROUTES = {"/v1/responses": "/responses", "/v1/responses/compact": "/responses/compact"}
_BODY_LIMIT = 32 * 1024 * 1024


class _RelayServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    relay: "ResponsesRelay"


class _RelayHandler(BaseHTTPRequestHandler):
    server: _RelayServer
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        # HTTP payloads and URLs are not diagnostic output: they can include model input.
        return

    def fail(self, status: int, message: str, *, code: str = "aino_code_route_error"):
        data = json.dumps({"error": {"message": message, "type": "aino_code_route_error", "code": code}}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(data)

    def do_POST(self):
        relay = self.server.relay
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + relay.token):
            self.fail(401, "This Code request is not authorized.")
            return
        suffix = _ROUTES.get(self.path)
        if suffix is None:
            self.fail(404, "This Code route is not supported.")
            return
        with relay.lock:
            context = relay.context.copy() if relay.context is not None else None
            turn_token = relay.turn_token
        if context is None:
            self.fail(409, "The Code turn is no longer active.")
            return
        body = self.read_body()
        if body is not None:
            context.run(relay.forward, self, suffix, body, turn_token)

    def read_body(self) -> bytes | None:
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            size = -1
        if self.headers.get("Transfer-Encoding") or not 0 <= size <= _BODY_LIMIT:
            self.fail(400, "The Code request body has an invalid size.")
            return None
        data = self.rfile.read(size)
        try:
            payload = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            self.fail(400, "The Code request body must be JSON.")
            return None
        if not isinstance(payload, dict) or payload.get("model") != self.server.relay.route.model:
            self.fail(403, "The Code request does not match the selected model.")
            return None
        return data


class ResponsesRelay:
    """One session's scoped upstream route, owned and closed with its Codex session."""

    def __init__(self, route: CodeModelRoute, *, replay=None):
        self.route = route
        self.replay = replay
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.context: contextvars.Context | None = None
        self.turn_token = None
        self.client = httpx.Client(timeout=httpx.Timeout(600, connect=10), follow_redirects=False,
                                   trust_env=not is_local_endpoint(route.base_url))
        self.server = _RelayServer(("127.0.0.1", 0), _RelayHandler)
        self.server.relay = self
        self.base_url = f"http://127.0.0.1:{self.server.server_port}/v1"
        self.thread = spawn_context_thread(self.server.serve_forever, name="aino-code-model-route")
        self.thread.start()
        self.closed = False

    @contextmanager
    def turn_context(self):
        # Capture each turn, not just process startup: billing and profile authority
        # are ContextVars and a later turn must never reuse the earlier turn's scope.
        with self.lock:
            token = self.turn_token = object()
            self.context = contextvars.copy_context()
        try:
            yield
        finally:
            with self.lock:
                if self.turn_token is token:
                    self.context = self.turn_token = None

    def turn_active(self, token):
        with self.lock:
            return token is not None and self.turn_token is token and self.context is not None

    def request(self, handler: _RelayHandler, suffix: str, body: bytes) -> httpx.Request:
        headers = httpx.Headers({name: value for name, value in handler.headers.items() if name.lower() in _REQUEST_HEADERS})
        headers.update({name: value for name, value in self.route.headers.items() if name.lower() not in _HOP_HEADERS})
        headers["Accept-Encoding"] = "identity"
        if self.route.api_mode == "anthropic_messages":
            headers.setdefault("anthropic-version", "2023-06-01")
        credential = self.route.credential
        if not isinstance(credential, ManagedCredential):
            key = credential() if callable(credential) else credential
            if key:
                if self.route.api_mode == "anthropic_messages":
                    for name, value in anthropic_http_headers(key, self.route.base_url).items():
                        if name.lower() in {"authorization", "x-api-key"}:
                            headers.pop("x-api-key" if name.lower() == "authorization" else "authorization", None)
                            headers[name] = value
                        else:
                            headers.setdefault(name, value)
                else:
                    headers["Authorization"] = f"Bearer {key}"
        request = self.client.build_request("POST", self.route.base_url + suffix, content=body, headers=headers)
        if isinstance(credential, ManagedCredential):
            credential.prepare_request(request)
        return request

    def forward(self, handler: _RelayHandler, suffix: str, body: bytes, turn_token):
        sent_headers = False
        try:
            if not self.turn_active(turn_token):
                handler.fail(409, "The Code turn is no longer active.")
                return
            prepared = None
            if self.route.bridged:
                from .protocol_request import prepare_request
                if suffix != "/responses":
                    handler.fail(404, "This route uses Codex's local history compaction, not an upstream compact endpoint.")
                    return
                try:
                    prepared = prepare_request(json.loads(body), self.route.api_mode,
                                               base_url=self.route.base_url, replay=self.replay)
                except ValueError:
                    handler.fail(400, "This Code request contains tool or history data that the selected protocol cannot "
                                 "represent. Use a native Responses connection for this feature; no model request was sent.",
                                 code="unsupported_code_request")
                    return
                suffix, body = prepared.path, json.dumps(prepared.body, ensure_ascii=False).encode()
            request = self.request(handler, suffix, body)
            if not self.turn_active(turn_token):
                handler.fail(409, "The Code turn is no longer active.")
                return
            with closing(self.client.send(request, stream=True)) as response:
                if response.is_redirect:
                    logger.warning("Aino Code route failed: code=upstream_redirect status=%s", response.status_code)
                    handler.fail(502, "The selected model endpoint redirected the request; update its address in settings.",
                                 code="upstream_redirect")
                    return
                if response.is_error:
                    # Upstreams may echo arbitrary credential-bearing custom headers.
                    # Preserve the HTTP verdict without returning that body to Codex.
                    request_id = response.headers.get("x-request-id", "")
                    request_id = request_id if re.fullmatch(r"[A-Za-z0-9_-]{1,100}", request_id) else "unavailable"
                    logger.warning("Aino Code route failed: code=upstream_http_error status=%s request_id=%s",
                                   response.status_code, request_id)
                    handler.fail(response.status_code, f"The selected model endpoint rejected this request (HTTP {response.status_code}; "
                                 f"request ID: {request_id}). Check its model configuration and account status.",
                                 code="upstream_http_error")
                    return
                handler.send_response(response.status_code)
                if prepared is None:
                    for name, value in response.headers.items():
                        if name.lower() in _RESPONSE_HEADERS:
                            handler.send_header(name, value)
                else:
                    handler.send_header("Content-Type", "text/event-stream")
                handler.send_header("Connection", "close")
                handler.end_headers()
                handler.close_connection = sent_headers = True
                chunks = (response.iter_raw() if prepared is None else self.converted_stream(response, prepared))
                for chunk in chunks:
                    handler.wfile.write(chunk)
                    handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        except (httpx.HTTPError, RuntimeError, ValueError) as error:
            code = ("upstream_timeout" if isinstance(error, httpx.TimeoutException) else
                    "upstream_connection_error" if isinstance(error, httpx.HTTPError) else "request_preparation_error")
            # Exception text and upstream bodies can contain credentials or model input.
            logger.warning("Aino Code route failed: code=%s streaming=%s", code, sent_headers)
            if not sent_headers:
                handler.fail(502, f"Aino Code could not use the selected model route ({code}). "
                             "Check its connection and account status.", code=code)

    def converted_stream(self, response, prepared):
        from .protocol_stream import response_events
        try:
            for sequence, event in enumerate(response_events(response, prepared, self.route.api_mode, self.replay)):
                yield _sse_event({**event, "sequence_number": sequence})
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            # Never echo vendor bodies/exception text or release an incomplete tool.
            logger.warning("Aino Code protocol adapter failed: type=%s", type(exc).__name__)
            yield _sse_event({"type": "response.failed", "response": {"status": "failed", "output": [],
                              "error": {"code": "aino_protocol_stream_invalid", "message":
                              "The model did not return a complete compatible response. No automatic retry was made."}}})

    def close(self):
        if self.closed:
            return
        self.closed = True
        with self.lock:
            self.context = self.turn_token = None
        self.client.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def _sse_event(event):
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n".encode()
