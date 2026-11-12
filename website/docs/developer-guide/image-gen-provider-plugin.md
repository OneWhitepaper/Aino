---
sidebar_position: 11
title: "Image Generation Provider Plugins"
description: "How to build an image-generation backend plugin for Hermes Agent"
---

# Building an Image Generation Provider Plugin

Account-backed catalogs may override
`CatalogProviderBase.accepts_model_selection(model_id)` when the authoritative
catalog lives in the authenticated desktop process. The default validates
against `list_models()`. An override validates only a saved non-secret preference;
it must not grant permission. The Aino image provider accepts a bounded catalog
identifier here and requires a matching, short-lived image-purpose lease at
dispatch. `list_models()` returns the current preference for readback without
copying account credentials or duplicating the remote model catalog.

## Account-managed image execution

The Aino image plugin combines the published
`agent.managed_image_provider.ManagedImageGenMixin` with the existing
OpenAI-compatible image executor. Put the mixin first in the class's base list.
The executor supplies `_image_config()`, `_image_dependencies_available()`,
`_size(size, aspect)`, `_client(openai, base_url, api_key)` and `generate(...)`;
configuration/dependency probes, source-image loading, multipart edits, output caching and
usage extraction continue through that executor's normal implementation.

The mixin owns the account-managed policy rather than exposing billing internals
to the plugin. It reads the saved `image_gen` preference, requires a matching
image-purpose authority from the executing turn, resolves refreshed credentials
at each physical request, and keeps image billing correlated with the current
turn. The runtime alone binds and retires that authority. A plugin cannot acquire
it from environment variables, another session or an unrelated text-model key.

Image requests disable SDK retries. An uncertain outcome remains uncertain and
cannot automatically replay a paid generation or edit. Explicit device-key
rejections report the owner and credential version of the request that actually
failed; an upstream authentication or billing failure does not revoke a device.
Models and supported quality values remain bounded by the live account catalog.
The concrete consumer is `plugins/image_gen/aino`, registered through the normal
backend discovery path. Other image plugins keep using `ImageGenProvider` and
their own authentication policy.

Image-gen provider plugins register a backend that services every `image_generate` tool call — DALL·E, gpt-image, Grok, Flux, Imagen, Stable Diffusion, fal, Replicate, a local ComfyUI rig, anything. Built-in providers (OpenAI, OpenAI-Codex, xAI, FAL, Krea, DeepInfra, OpenRouter, Meta Model API) all ship as plugins. You can add a new one, or override a bundled one, by dropping a directory into `plugins/image_gen/<name>/`.

:::tip
Image-gen is one of several **backend plugins** Hermes supports. The others (with more specialized ABCs) are [Memory Provider Plugins](./memory-provider-plugin.md), [Context Engine Plugins](./context-engine-plugin.md), and [Model Provider Plugins](./model-provider-plugin.md). General tool/hook/CLI plugins live in [Build a Hermes Plugin](./plugins/index.md).
:::

## How discovery works

Hermes scans for image-gen backends in three places:

1. **Bundled** — `<repo>/plugins/image_gen/<name>/` (auto-loaded with `kind: backend`, always available)
2. **User** — `~/.hermes/plugins/image_gen/<name>/` (opt-in via `plugins.enabled`)
3. **Pip** — packages declaring a `hermes_agent.plugins` entry point

Each plugin's `register(ctx)` function calls `ctx.register_image_gen_provider(...)` — that puts it into the registry in `agent/image_gen_registry.py`. The active provider is picked by `image_gen.provider` in `config.yaml`; `hermes tools` walks users through selection.

The `image_generate` tool wrapper asks the registry for the active provider and dispatches there. If no provider is registered, the tool surfaces a helpful error pointing at `hermes tools`.

## Directory structure

```
plugins/image_gen/my-backend/
├── __init__.py      # ImageGenProvider subclass + register()
└── plugin.yaml      # Manifest with kind: backend
```

A bundled plugin is complete at this point. User plugins at `~/.hermes/plugins/image_gen/<name>/` need to be added to `plugins.enabled` in `config.yaml` (or run `hermes plugins enable <name>`).

## The ImageGenProvider ABC

Subclass `agent.image_gen_provider.ImageGenProvider`. The only required members are the `name` property and the `generate()` method — everything else has sane defaults:

```python
# plugins/image_gen/my-backend/__init__.py
from typing import Any, Dict, List, Optional
import os

from agent.image_gen_provider import (
    DEFAULT_ASPECT_RATIO,
    ImageGenProvider,
    error_response,
    normalize_reference_images,
    resolve_aspect_ratio,
    save_b64_image,
    success_response,
)


class MyBackendImageGenProvider(ImageGenProvider):
    @property
    def name(self) -> str:
        # Stable id used in image_gen.provider config. Lowercase, no spaces.
        return "my-backend"

    @property
    def display_name(self) -> str:
        # Human label shown in `hermes tools`. Defaults to name.title() if omitted.
        return "My Backend"

    def is_available(self) -> bool:
        # Return False if credentials or deps are missing.
        # The tool's availability gate calls this before dispatch.
        if not os.environ.get("MY_BACKEND_API_KEY"):
            return False
        try:
            import my_backend_sdk  # noqa: F401
        except ImportError:
            return False
        return True

    def list_models(self) -> List[Dict[str, Any]]:
        # Catalog shown in `hermes tools` model picker.
        return [
            {
                "id": "my-model-fast",
                "display": "My Model (Fast)",
                "speed": "~5s",
                "strengths": "Quick iteration",
                "price": "$0.01/image",
            },
            {
                "id": "my-model-hq",
                "display": "My Model (HQ)",
                "speed": "~30s",
                "strengths": "Highest fidelity",
                "price": "$0.04/image",
            },
        ]

    def default_model(self) -> Optional[str]:
        return "my-model-fast"

    def get_setup_schema(self) -> Dict[str, Any]:
        # Metadata for the `hermes tools` picker — keys to prompt for at setup.
        return {
            "name": "My Backend",
            "badge": "paid",        # optional; shown as a short tag in the picker
            "tag": "One-line description shown under the name",
            "env_vars": [
                {
                    "key": "MY_BACKEND_API_KEY",
                    "prompt": "My Backend API key",
                    "url": "https://my-backend.example.com/api-keys",
                },
            ],
        }

    def capabilities(self) -> Dict[str, Any]:
        # Declare whether this backend supports image-to-image / editing.
        # The tool layer surfaces this in the dynamic schema so the model
        # knows when `image_url` is honored. Default (if you omit this) is
        # text-only: {"modalities": ["text"], "max_reference_images": 0}.
        # Optional keys: "supports_upscale" (bool) adds an `upscale` param, and
        # "creative_controls" lists the controls you honor from `creativity`,
        # `intensity`, `complexity`, `movement`, `thinking`, `resolution`, `size`. Only declared controls appear
        # in the schema and reach generate() as kwargs. "source_image_role": "style"
        # tells the model that image inputs set the look and are not edited.
        return {"modalities": ["text", "image"], "max_reference_images": 4}

    def generate(
        self,
        prompt: str,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        *,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        prompt = (prompt or "").strip()
        aspect_ratio = resolve_aspect_ratio(aspect_ratio)

        if not prompt:
            return error_response(
                error="Prompt is required",
                error_type="invalid_input",
                provider=self.name,
                prompt="",
                aspect_ratio=aspect_ratio,
            )

        # Routing: if image_url (or reference_image_urls) is set, the call is
        # an image-to-image / edit request; otherwise text-to-image. Report
        # which path you took via the `modality` field of success_response.
        sources = []
        if image_url:
            sources.append(image_url)
        sources.extend(normalize_reference_images(reference_image_urls) or [])
        modality = "image" if sources else "text"

        # Model selection precedence: env var → config → default. The helper
        # _resolve_model() in the built-in openai plugin is a good reference.
        model_id = kwargs.get("model") or self.default_model() or "my-model-fast"

        try:
            import my_backend_sdk
            client = my_backend_sdk.Client(api_key=os.environ["MY_BACKEND_API_KEY"])
            if modality == "image":
                result = client.edit(
                    prompt=prompt,
                    model=model_id,
                    image_urls=sources,
                )
            else:
                result = client.generate(
                    prompt=prompt,
                    model=model_id,
                    aspect_ratio=aspect_ratio,
                )

            # Two shapes supported:
            #   - URL string: return it as `image`
            #   - base64 data: save under $HERMES_HOME/cache/images/ via save_b64_image()
            if result.get("image_b64"):
                path = save_b64_image(
                    result["image_b64"],
                    prefix=self.name,
                    extension="png",
                )
                image = str(path)
            else:
                image = result["image_url"]

            return success_response(
                image=image,
                model=model_id,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                provider=self.name,
                modality=modality,
            )
        except Exception as exc:
            return error_response(
                error=str(exc),
                error_type=type(exc).__name__,
                provider=self.name,
                model=model_id,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
            )


def register(ctx) -> None:
    """Plugin entry point — called once at load time."""
    ctx.register_image_gen_provider(MyBackendImageGenProvider())
```

## plugin.yaml

```yaml
name: my-backend
version: 1.0.0
description: My image backend — text-to-image via My Backend SDK
author: Your Name
kind: backend
requires_env:
  - MY_BACKEND_API_KEY
```

`kind: backend` is what routes the plugin to the image-gen registration path. `requires_env` is prompted during `hermes plugins install`.

## ABC reference

Full contract in `agent/image_gen_provider.py`. The methods you'll typically override:

| Member | Required | Default | Purpose |
|---|---|---|---|
| `name` | ✅ | — | Stable id used in `image_gen.provider` config |
| `display_name` | — | `name.title()` | Label shown in `hermes tools` |
| `is_available()` | — | `True` | Gate for missing creds/deps |
| `list_models()` | — | `[]` | Catalog for `hermes tools` model picker |
| `default_model()` | — | first from `list_models()` | Fallback when no model is configured |
| `get_setup_schema()` | — | minimal | Picker metadata + env-var prompts |
| `generate(prompt, aspect_ratio, **kwargs)` | ✅ | — | The call |

### Explicit pixel dimensions

The OpenAI and Aino providers declare `creative_controls: ["size"]`. The optional
`size` kwarg accepts `auto` or positive pixel dimensions such as `2048x2048`,
`2048x3072`, `3840x2160`, or `4096x4096`. An explicit value overrides the
`aspect_ratio` preset for both generation and reference-image editing. Omission
keeps the existing square, landscape and portrait defaults. Size syntax is
validated before credential lookup or an API request; supported dimensions still
depend on the selected model and upstream endpoint. An unsupported size is an
error, without a fallback to a smaller size or local interpolation.

Declare this protocol capability independently of a turn's credentials. Tool
schemas are frozen for each conversation; newly exposed controls take effect in
a new conversation rather than changing an existing cached prompt.

## Response format

`generate()` must return a dict built via `success_response()` or `error_response()`. Both live in `agent/image_gen_provider.py`.

**Success:**
```python
success_response(
    image=<url-or-absolute-path>,
    model=<model-id>,
    prompt=<echoed-prompt>,
    aspect_ratio="landscape" | "square" | "portrait",
    provider=<your-provider-name>,
    extra={...},  # optional backend-specific fields
)
```

**Error:**
```python
error_response(
    error="human-readable message",
    error_type="provider_error" | "invalid_input" | "<exception class name>",
    provider=<your-provider-name>,
    model=<model-id>,
    prompt=<prompt>,
    aspect_ratio=<resolved aspect>,
)
```

The tool wrapper JSON-serializes the dict and hands it to the LLM. Errors are surfaced as the tool result; the LLM decides how to explain them to the user.

OpenAI and Aino results retain `size` as the requested value and also return
`requested_size`, `actual_size`, and the desktop-compatible `pixel_size` alias.
The latter two describe the cached original image's pixel dimensions, or `None`
when they cannot be read. Report an upstream size mismatch to the user; neither
a requested size nor a billing tier proves the output dimensions. Keep the
original image bytes unchanged.

## Handling base64 vs URL output

Some backends return image URLs (fal, Replicate); others return base64 payloads (OpenAI gpt-image-2). For the base64 case, use `save_b64_image()` — it writes to `$HERMES_HOME/cache/images/<prefix>_<timestamp>_<uuid>.<ext>` and returns the absolute `Path`. Pass that path (as `str`) as `image=` in `success_response()`. Gateway delivery (Telegram photo bubble, Discord attachment) recognizes both URLs and absolute paths.

## User overrides

Drop a user plugin at `~/.hermes/plugins/image_gen/<name>/` with the same `name` property as a bundled one and enable it via `hermes plugins enable <name>` — the registry is last-writer-wins, so your version replaces the built-in. Useful for pointing an `openai` plugin at a private proxy, or swapping in a custom model catalog.

## Testing

```bash
export HERMES_HOME=$HOME/.hermes/cache/scratch/hermes-imggen-test
mkdir -p $HERMES_HOME/plugins/image_gen/my-backend
# …copy __init__.py + plugin.yaml into that dir…

export MY_BACKEND_API_KEY=your-test-key
hermes plugins enable my-backend

# Pick it as the active provider
echo "image_gen:" >> $HERMES_HOME/config.yaml
echo "  provider: my-backend" >> $HERMES_HOME/config.yaml

# Exercise it
hermes -z "Generate an image of a corgi in a spacesuit"
```

Or interactively: `hermes tools` → "Image Generation" → select `my-backend` → enter API key if prompted.

## Reference implementations

- **`plugins/image_gen/openai/__init__.py`** — gpt-image-2 at low/medium/high tiers as three virtual model IDs sharing one API model with different `quality` params. Good example of tiered models under a single backend + config.yaml precedence chain.
- **`plugins/image_gen/xai/__init__.py`** — Grok Imagine via xAI. Different shape (URL output, simpler catalog).
- **`plugins/image_gen/openai-codex/__init__.py`** — same catalog as `openai`, but authenticated with the ChatGPT/Codex OAuth token and posted with plain `httpx` to the Codex backend's native `images/generations` / `images/edits` endpoints. Good example of a provider that fetches remote source images client-side and inlines them as data URLs, and that reports backend-returned metadata separately from the request.

## Distribute via pip

```toml
# pyproject.toml
[project.entry-points."hermes_agent.plugins"]
my-backend-imggen = "my_backend_imggen_package"
```

`my_backend_imggen_package` must expose a top-level `register` function. See [Distribute via pip](./plugins/index.md#distribute-via-pip) in the general plugin guide for the full setup.

## Related pages

- [Image Generation](../user-guide/features/image-generation.md) — user-facing feature documentation
- [Plugins overview](../user-guide/features/plugins.md) — all plugin types at a glance
- [Build a Hermes Plugin](./plugins/index.md) — general tools/hooks/slash commands guide
