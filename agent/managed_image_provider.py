"""Managed image execution policy for account-backed image provider plugins.

The runtime binds the turn's live authority here; the mixin owns billing,
credential refresh and refusal/unknown-outcome handling. Concrete image
executors continue to own source-image IO, request construction and caching.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import replace
from datetime import UTC, datetime
import re
from uuid import NAMESPACE_OID, uuid4, uuid5

from agent.image_gen_provider import DEFAULT_ASPECT_RATIO, error_response, resolve_aspect_ratio
from agent.managed_inference_errors import ManagedOperationUnknown, raise_managed_operation_error


_image_binding = ContextVar("managed_image_binding_resolver", default=None)


@contextmanager
def managed_image_scope(resolve, *, on_rejection=None):
    active = [True]

    def live_binding():
        return resolve() if active[0] else None

    token = _image_binding.set((live_binding, on_rejection))
    try:
        yield
    finally:
        active[0] = False
        _image_binding.reset(token)


def current_image_binding():
    scope = _image_binding.get()
    binding = scope[0]() if scope else None
    if (binding is None or binding.purpose != "image"
            or (binding.expires_at is not None and binding.expires_at <= datetime.now(UTC))):
        return None
    return binding


def notify_image_credential_rejection(owner_user_id, credential_version):
    scope = _image_binding.get()
    if scope is None or scope[1] is None or type(credential_version) is not int or credential_version <= 0:
        return
    binding = current_image_binding()
    if binding is None or binding.owner.user_id != owner_user_id:
        return
    scope[1]({
        'text': 'Aino device authorization was rejected. Check this device\'s authorization in your account.',
        'level': 'error', 'kind': 'sticky', 'key': 'aino.managed_credential_rejected',
        'code': 'managed_credential_rejected', 'billing_source': 'aino', 'purpose': 'image',
        'owner_user_id': owner_user_id, 'managed_credential_version': credential_version,
    })


class UnsupportedImageQuality(ValueError):
    pass


class ManagedImageGenMixin:
    """Account-managed policy layered before an OpenAI-compatible image executor.

    The executor supplies its config/dependency probes, ``_size``, ``_client``
    and ``generate``; this mixin never owns a provider registry or another
    execution loop.
    """

    def is_available(self):
        config = self._image_config()
        return config.get("provider") == "aino" and bool(config.get("model")) and self._image_dependencies_available()

    def list_models(self):
        model = self._image_config().get("model")
        return [{"id": model, "display": model}] if isinstance(model, str) and model else []

    def default_model(self):
        return None

    def accepts_model_selection(self, model_id):
        # A stored catalog id is a preference, not authority: the API validates the account allowlist.
        return bool(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}", model_id))

    def _model(self):
        binding = current_image_binding()
        if binding is None:
            raise RuntimeError("awaiting_managed_image_credentials")
        quality_options = binding.capabilities.get("image_quality_options", [])
        quality = self._image_config().get("quality")
        if quality is None and "auto" in quality_options:
            quality = "auto"
        if quality is not None and quality not in quality_options:
            raise UnsupportedImageQuality("unsupported_image_quality")
        return binding.model_id, {"api_model": binding.model, "quality": quality}

    def _endpoint(self):
        from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, billing_scope

        binding = current_image_binding()
        if binding is None:
            raise RuntimeError("awaiting_managed_image_credentials")
        identity = (binding.owner, binding.model_id, binding.model, binding.base_url)
        def current_binding():
            current = current_image_binding()
            if current is None or identity != (current.owner, current.model_id, current.model, current.base_url):
                raise RuntimeError("awaiting_managed_image_credentials")
            return current

        def key():
            return current_binding().api_key

        def request_identity():
            current = current_binding()
            return (current.api_key, current.model_id if current.credential_type == 'device' else None,
                    current.credential_version)

        scope = billing_scope.get()
        if scope is None:
            session_id = str(uuid5(NAMESPACE_OID, binding.session_id))
            scope = BillingScope("aino", binding.owner.user_id, session_id, str(uuid4()), "image")
        elif scope.source == "aino":
            if scope.user_id != binding.owner.user_id:
                raise RuntimeError("managed_image_account_mismatch")
            scope = replace(scope, purpose="image")
        else:
            scope = replace(scope, source="aino", user_id=binding.owner.user_id,
                            session_id=str(uuid5(NAMESPACE_OID, scope.session_id)), purpose="image")
            scope.calls.bind_managed_owner(binding.owner.user_id, scope.session_id)
            scope.calls.record_non_aino_model_call()
        credential = ManagedCredential(key, binding.owner.user_id, scope.session_id, binding.model,
                                       binding.base_url, binding.api_mode, False, scope=scope,
                                       model_id=binding.model_id if binding.credential_type == 'device' else None,
                                       get_request_identity=request_identity)
        return binding.base_url, credential

    def _client(self, openai, base_url, api_key):
        from agent.auxiliary_billing_scope import configure_managed_http

        client = super()._client(openai, base_url, api_key)
        configure_managed_http({"http_client": client._client}, api_key)
        # Image requests can take minutes. Retrying an accepted request can bill twice.
        return client.with_options(max_retries=0, timeout=300.0)

    def _api_failure(self, exc, verb):
        from agent.managed_inference_errors import managed_credential_rejection

        if rejected := managed_credential_rejection(exc):
            notify_image_credential_rejection(*rejected)
        body = getattr(exc, "body", None)
        detail = body.get("error", body) if isinstance(body, dict) else {}
        if isinstance(detail, dict) and detail.get("code") == "DESKTOP_OPERATION_UNKNOWN":
            raise ManagedOperationUnknown() from exc
        status = getattr(exc, "status_code", None)
        if status not in (400, 429):
            raise_managed_operation_error(exc, managed=True)
        if status == 400 and verb == "editing":
            return "Aino 未能接受这次改图请求，请检查原图、图片尺寸、参数及所选模型是否支持图片编辑。"
        if status == 400:
            return "Aino 未能接受这次生图请求，请检查所选模型是否支持指定图片尺寸和参数。"
        messages = {401: "Aino 登录或生图授权已失效，请重新登录后再试。",
                    403: "当前账户没有使用这个生图模型的权限。",
                    402: "Aino 账户余额或可用额度不足，请到我的账户查看。",
                    429: "生图请求过于频繁，请稍后再试。"}
        return messages.get(status, "Aino 生图暂未完成，请先查看账户用量，确认后再决定是否重试。")

    def generate(self, prompt, aspect_ratio=DEFAULT_ASPECT_RATIO, *, image_url=None,
                 reference_image_urls=None, size=None, **kwargs):
        from agent.auxiliary_billing_scope import managed_operation_dispatched, managed_operation_scope

        aspect = resolve_aspect_ratio(aspect_ratio)
        def fail(message, kind):
            return error_response(error=message, error_type=kind, provider="aino",
                                  prompt=prompt, aspect_ratio=aspect)

        try:
            size = self._size(size, aspect)
        except ValueError:
            return fail("图片尺寸应为 auto 或正整数 WIDTHxHEIGHT，例如 2048x3072。", "invalid_argument")
        binding = current_image_binding()
        if binding is None:
            return fail("Aino 生图授权尚未就绪，请登录 Aino 并在设置 → 模型 → 图像生成中选择模型。",
                        "auth_required")
        selected = self._image_config()
        requested = kwargs.get("model") or selected.get("model")
        if (selected.get("provider") != "aino" or requested != binding.model_id
                or selected.get("model") != binding.model_id):
            return fail("生图模型已改变，请重新发送消息以取得对应授权。", "model_unavailable")
        try:
            with managed_operation_scope("image:" + str(uuid4())):
                result = super().generate(prompt, aspect, image_url=image_url,
                                          reference_image_urls=reference_image_urls, size=size)
                if (not result.get("success") and result.get("error_type") in {"empty_response", "io_error"}
                        and managed_operation_dispatched()):
                    raise ManagedOperationUnknown()
                return result
        except UnsupportedImageQuality:
            return fail("当前生图模型不支持所选画质，请在设置 → 模型 → 图像生成中重新选择。", "quality_unsupported")
        except ManagedOperationUnknown as exc:
            result = fail(str(exc), "managed_operation_unknown")
            result.update(failure_reason="managed_operation_unknown", failure_retryable=False)
            return result
        except RuntimeError:
            return fail("Aino 生图授权已改变，请重新发送消息后再试。", "auth_required")
