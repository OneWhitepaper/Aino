# Aino 技术参考 · Providers & Model Aliases

> **Aino 适用范围**：本章保留服务商、模型别名及当前会话切换的技术流程。Aino 优先使用账户可用的内置模型或已配置模型，设备 Key 识别账户，内置模型权限与费用逐次判断；群内临时切换只作用于当前群聊会话，不改机器人默认模型。真实服务商名称与凭据边界继续保留。
>
> 本文中的 Hermes 代表 Aino 复用的底层兼容运行时；命令、模块、路径示例和协议名按技术接口保留。
> 当前产品说明：[模型与生图](../../models-and-images.md)、[账户与设备](../../accounts-and-devices.md)。
> 来源：`skills/autonomous-ai-agents/hermes-agent/references/providers-and-models.md`；原帮助技能署名 Hermes Agent + Teknium，MIT。下方保留完整原文、表格、命令与示例。

Set via `hermes model` (picker) or `hermes setup`. 35+ provider profiles ship as
plugins under `plugins/model-providers/`; user plugins of the same name override.
Full docs: https://hermes-agent.nousresearch.com/docs/integrations/providers

### Aino desktop conversations and Agent Hub groups

For a request such as “switch to DeepSeek”, query the actual available models first:

```bash
hermes model --list --json
hermes model --set '<exact-model-id-from-the-list>' --provider aino --json
```

The listing comes from the connected desktop's current Aino account and configured
providers. Aino built-in models already use the account's device Key: users do not
need a separate official-provider key for those models. Prefer a matching available
Aino built-in model, then a matching configured provider. Use its exact listed ID
and provider. If several models fit, show the candidates and let the user choose;
do not invent a model ID, provider, endpoint or credential availability.

This schedules a choice for this conversation's **next message**. The current reply
keeps its original model. It does not change the saved default model or another
robot's conversation. A `scheduled` result is acceptance, not a successful model
inference; report that distinction. If no desktop answers, report unavailable and
retain the previous route. Never use `hermes config set/unset model.*` or edit
profile YAML/auth.json to work around the conversation's managed-model binding.
Configure provider accounts and global defaults through Settings when requested.

### Providers

| Provider | Auth | Key env var(s) |
|----------|------|----------------|
| openrouter | API key | `OPENROUTER_API_KEY` |
| anthropic | API key | `ANTHROPIC_API_KEY` (also `CLAUDE_CODE_OAUTH_TOKEN`) |
| nous | OAuth device code | `hermes auth add nous` (or `NOUS_API_KEY`) |
| openai-codex | OAuth | `hermes auth add openai-codex` |
| qwen-oauth | OAuth | `hermes auth add qwen-oauth` |
| minimax-oauth | OAuth | `hermes auth add minimax-oauth` |
| gemini | API key | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| xai | API key | `XAI_API_KEY` (SuperGrok OAuth also supported) |
| deepseek | API key | `DEEPSEEK_API_KEY` |
| zai (GLM) | API key | `GLM_API_KEY` / `ZAI_API_KEY` |
| minimax / minimax-cn | API key | `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY` |
| kimi-coding / -cn | API key | `KIMI_API_KEY` / `KIMI_CN_API_KEY` |
| alibaba (+coding-plan) | API key | `DASHSCOPE_API_KEY` / `ALIBABA_CODING_PLAN_API_KEY` |
| xiaomi | API key | `XIAOMI_API_KEY` |
| huggingface | Token | `HF_TOKEN` |
| fireworks / novita / nvidia / deepinfra / gmi / arcee / stepfun / upstage / kilocode / ai-gateway / opencode-zen / opencode-go / ollama-cloud | API key | `<NAME>_API_KEY` |
| bedrock / vertex / azure-foundry | Cloud SDK / key | AWS SDK creds / Vertex ADC / `AZURE_FOUNDRY_API_KEY` |
| custom | Config | `model.base_url` + `model.api_key` in config.yaml |

GitHub Copilot (`copilot`, `copilot-acp`) is a labs plugin, not core: `hermes plugins install github-copilot`, then `hermes auth add copilot` (https://github.com/NousResearch/hermes-labs-plugins/tree/main/github-copilot).

Multiple credentials per provider pool and rotate automatically (`hermes auth`).
Fallback chain when the primary fails: `hermes fallback add|remove|list`.

### User-defined model aliases

Work with `/model <name>` in CLI and every gateway platform. Resolved by
`hermes_cli/model_switch.py::resolve_alias()`; user aliases are checked BEFORE
the built-in table, so a user `sonnet`/`grok` shadows the built-in.

```yaml
# Full form
model_aliases:
  fav:
    model: claude-sonnet-4.6
    provider: anthropic
  local-qwen:
    model: qwen3.5:397b
    provider: custom
    base_url: "https://ollama.com/v1"
  theta:
    model: theta-1
    provider: custom
    base_url: "https://theta.example.com/v1"
    key_env: THETA_API_KEY        # or: api_key: "${THETA_API_KEY}"

# Short form ("provider/model"), also via CLI:
#   hermes config set model.aliases.fav openrouter/anthropic/claude-sonnet-4.6
model:
  aliases:
    fav: openrouter/anthropic/claude-sonnet-4.6
```

`/model fav` — session-scoped; add `--global` to persist as default.

An alias with its own `base_url` authenticates with its own credential
(`api_key`, which also accepts a `"${VAR}"` reference, or `key_env`). With
neither set the key is resolved from the alias HOST, never carried over from
the provider that was active before the switch.

Built-in aliases (catalog-resolved against the active provider): `sonnet`,
`opus`, `haiku`, `claude`, `gpt5`, `gpt`, `codex`, `o3`, `o4`, `gemini`,
`deepseek`, `grok`, `llama`, `qwen`, `minimax`, `nemotron`, `kimi`, `glm`,
`step`, `mimo`, `trinity`.
