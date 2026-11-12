"""Aino account binding on the existing OpenAI-compatible image executor."""

from agent.managed_image_provider import ManagedImageGenMixin
from plugins.image_gen.openai import OpenAIImageGenProvider


class AinoImageGenProvider(ManagedImageGenMixin, OpenAIImageGenProvider):
    provider_id = "aino"
    label = "Aino"
    models = {}
    default_model_id = None

    def get_setup_schema(self):
        return {"name": "Aino", "badge": "paid", "env_vars": [],
                "image_gen_plugin_name": "aino",
                "tag": "使用 Aino 账户生成图片，费用计入账户用量，无需另外填写密钥"}


def register(ctx):
    ctx.register_image_gen_provider(AinoImageGenProvider())
