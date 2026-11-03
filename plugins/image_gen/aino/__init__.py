"""Aino account binding on the existing OpenAI-compatible image executor."""

from dataclasses import replace
import re
from uuid import NAMESPACE_OID, uuid4, uuid5

from agent.image_gen_provider import DEFAULT_ASPECT_RATIO, error_response, resolve_aspect_ratio
from plugins.image_gen._common import load_image_gen_config, openai_importable
from plugins.image_gen.openai import OpenAIImageGenProvider, _build_client, _resolve_image_size
from tui_gateway.managed_image_runtime import current_image_binding


class UnsupportedImageQuality(ValueError):
    pass


class AinoImageGenProvider(OpenAIImageGenProvider):
    provider_id = "aino"
    label = "Aino"
    models = {}
    default_model_id = None

    def get_setup_schema(self):
        return {"name": "Aino", "badge": "paid", "env_vars": [],
                "image_gen_plugin_name": "aino",
                "tag": "使用 Aino 账户生成图片，费用计入账户用量，无需另外填写密钥"}

    def is_available(self):
        config = load_image_gen_config()
        return config.get("provider") == "aino" and bool(config.get("model")) and openai_importable()

    def list_models(self):
        model = load_image_gen_config().get("model")
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
        quality = load_image_gen_config().get("quality")
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
        def key():
            current = current_image_binding()
            if current is None or identity != (current.owner, current.model_id, current.model, current.base_url):
                raise RuntimeError("awaiting_managed_image_credentials")
            return current.api_key

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
                                       binding.base_url, binding.api_mode, False, scope=scope)
        return binding.base_url, credential

    def _client(self, openai, base_url, api_key):
        from agent.auxiliary_billing_scope import configure_managed_http

        client = _build_client(openai, base_url, api_key)
        configure_managed_http({"http_client": client._client}, api_key)
        # Image requests can take minutes. Retrying an accepted request can bill twice.
        return client.with_options(max_retries=0, timeout=300.0)

    def _api_failure(self, exc, verb):
        status = getattr(exc, "status_code", None)
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
        aspect = resolve_aspect_ratio(aspect_ratio)
        def fail(message, kind):
            return error_response(error=message, error_type=kind, provider="aino",
                                  prompt=prompt, aspect_ratio=aspect)

        try:
            size = _resolve_image_size(size, aspect)
        except ValueError:
            return fail("图片尺寸应为 auto 或正整数 WIDTHxHEIGHT，例如 2048x3072。", "invalid_argument")
        binding = current_image_binding()
        if binding is None:
            return fail("Aino 生图授权尚未就绪，请登录 Aino 并在设置 → 模型 → 图像生成中选择模型。",
                        "auth_required")
        selected = load_image_gen_config()
        requested = kwargs.get("model") or selected.get("model")
        if (selected.get("provider") != "aino" or requested != binding.model_id
                or selected.get("model") != binding.model_id):
            return fail("生图模型已改变，请重新发送消息以取得对应授权。", "model_unavailable")
        try:
            return super().generate(prompt, aspect, image_url=image_url,
                                    reference_image_urls=reference_image_urls, size=size)
        except UnsupportedImageQuality:
            return fail("当前生图模型不支持所选画质，请在设置 → 模型 → 图像生成中重新选择。", "quality_unsupported")
        except RuntimeError:
            return fail("Aino 生图授权已改变，请重新发送消息后再试。", "auth_required")


def register(ctx):
    ctx.register_image_gen_provider(AinoImageGenProvider())
