# Aino 技术参考 · Configuration, Toolsets & Voice

> **Aino 适用范围**：本章保留底层配置、工具集与语音参数。Aino 内置模型、设备授权和桌面设置应先按当前产品指南操作；语音服务的免费档、价格与可用地区由真实服务商决定。云端会话同步已下线，不因底层配置支持某类远程服务而恢复。
>
> 本文中的 Hermes 代表 Aino 复用的底层兼容运行时；命令、模块、路径示例和协议名按技术接口保留。
> 当前产品说明：[设置](../../settings.md)、[模型与生图](../../models-and-images.md)。
> 来源：`skills/autonomous-ai-agents/hermes-agent/references/configuration.md`；原帮助技能署名 Hermes Agent + Teknium，MIT。下方保留完整原文、表格、命令与示例。

Edit with `hermes config edit` or `hermes config set section.key value`.
Full reference: https://hermes-agent.nousresearch.com/docs/user-guide/configuration

### Config Sections (most-used keys)

| Section | Key options |
|---------|-------------|
| `model` | `default`, `provider`, `base_url`, `api_key`, `context_length`, `aliases` |
| `agent` | `max_turns` (90), `tool_use_enforcement`, `service_tier`, `verify_on_stop` |
| `terminal` | `backend` (local/docker/ssh/modal/daytona/vercel_sandbox, or a plugin backend like singularity), `cwd`, `timeout` (180) |
| `compression` | `enabled`, `threshold` (0.50), `target_ratio` (0.20) |
| `display` | `skin`, `interface` (cli/tui), `language`, `show_reasoning`, `show_cost`, `pet` |
| `approvals` | `mode` (smart/manual/off), `timeout`, `cron_mode` |
| `stt` | `enabled`, `provider` (local/groq/openai/mistral/elevenlabs/deepinfra) |
| `tts` | `provider` (edge/elevenlabs/openai/minimax/mistral/neutts/gemini/piper/kittentts/deepinfra/xai) |
| `memory` | `memory_enabled`, `user_profile_enabled`, `provider`, `write_approval` |
| `security` | `redact_secrets`, `website_blocklist` |
| `browser` | `headed` (false), `engine` (auto/lightpanda), `executable_path` ("" = auto-detect Chromium), `user_data_dir` ("" = fresh ephemeral profile per session), `chromium_args` ([]), `command_timeout` (Chromium launch timeout floor), `cloud_provider`, `cdp_url`, `use_real_profile` |
| `delegation` | `model`, `provider`, `max_concurrent_children`, `max_iterations` (50), `max_spawn_depth` |
| `checkpoints` | `enabled`, `max_snapshots` (50) |
| `curator` | `enabled`, `consolidate` (false, opt-in aux-model consolidation), `interval_hours`, `stale_after_days` |

`hermes config check` reports sections missing from an older config.

### Toolsets

Enable/disable via `hermes tools` (interactive) or `hermes tools enable/disable NAME`.
Full enumeration: `TOOLSETS` dict in `toolsets.py` (`_HERMES_CORE_TOOLS` is the default bundle most platforms inherit).

| Toolset | What it provides |
|---------|-----------------|
| `web` / `search` | Web search + extraction / search-only subset |
| `browser` | `browser_exec` (Python CDP helpers), `browser_cdp`, `browser_dialog`, `browser_vault` — local Chromium, a cloud provider, or `/browser connect`. Disable this toolset to turn browsing off |
| `terminal` | Shell commands and process management |
| `file` | File read/write/search/patch |
| `code_execution` | Sandboxed Python execution |
| `coding` | Code-editing helpers (LSP-backed) |
| `computer_use` | Desktop GUI control (cua-driver) |
| `vision` | Image analysis |
| `image_gen` | Image generation and image-to-image editing |
| `video` / `video_gen` | Video analysis / video generation |
| `x_search` | X (Twitter) search (X OAuth or API key) |
| `tts` | Text-to-speech |
| `skills` | Skill browsing and management |
| `memory` | Persistent cross-session memory |
| `session_search` | Search past conversations |
| `context_engine` | Pluggable context-engine hooks |
| `project` | Named multi-folder workspace tools |
| `delegation` | Subagent task delegation |
| `cronjob` | Scheduled task management |
| `clarify` | Ask user clarifying questions |
| `todo` | In-session task planning |
| `kanban` | Multi-agent work-queue tools (gated to workers) |
| `debugging` | Extra introspection tools (off by default) |
| `safe` | Minimal low-risk toolset for locked-down sessions |
| `discord`, `discord_admin`, `feishu_doc`, `feishu_drive`, `yuanbao` | Service integrations (gated on their credentials). `homeassistant` (`ha_*` tools) and `spotify` (`spotify_*` tools) are not built in: they come from the `homeassistant` / `spotify` catalog plugins (`hermes plugins install <name>`) |

Camofox is no longer built in: `hermes plugins install camofox` adds it as the `camofox` toolset with its own browser tools. Existing Camofox setups are migrated automatically on `hermes update`.

Tool changes take effect on `/reset` (new session) — never mid-conversation, to preserve prompt caching.

## Voice

### STT (Voice → Text)

Voice messages from messaging platforms are auto-transcribed.

```yaml
stt:
  enabled: true
  provider: local   # local (faster-whisper, free) | groq | openai | mistral | elevenlabs | deepinfra
  local:
    model: base     # tiny, base, small, medium, large-v3, turbo
```

Auto-detect priority: local faster-whisper (`python -c "import pm; pm.sync_venv(['stt-whisper'], explicit=True)"`) → Groq (`GROQ_API_KEY`, free tier) → OpenAI (`VOICE_TOOLS_OPENAI_KEY`) → Mistral Voxtral (`MISTRAL_API_KEY`).

### TTS (Text → Voice)

| Provider | Env var | Free? |
|----------|---------|-------|
| Edge TTS (default) | None | Yes |
| ElevenLabs | `ELEVENLABS_API_KEY` | Free tier |
| OpenAI | `VOICE_TOOLS_OPENAI_KEY` | Paid |
| MiniMax | `MINIMAX_API_KEY` | Paid |
| Mistral | `MISTRAL_API_KEY` | Paid |
| Gemini | `GOOGLE_API_KEY` | Free tier |
| NeuTTS / Piper / KittenTTS (local) | None | Free |

Voice commands: `/voice on` (voice-to-voice), `/voice tts` (always voice), `/voice off`.
