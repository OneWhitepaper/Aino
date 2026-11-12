# Aino 技术参考 · Security & Privacy Toggles

> **Aino 适用范围**：本章保留秘密遮罩、审批和工具开关的完整说明。Aino 的审批仍针对具体操作，用户内容、第三方名称和原始错误证据不能被全局替换；关闭提示不代表扩大跨账户访问权限，旧审批卡片也不能授权后来的新请求。
>
> 本文中的 Hermes 代表 Aino 复用的底层兼容运行时；命令、模块、路径示例和协议名按技术接口保留。
> 当前产品说明：[扩展与安全](../../extensions-and-safety.md)、[账户与设备](../../accounts-and-devices.md)。
> 来源：`skills/autonomous-ai-agents/hermes-agent/references/security-privacy.md`；原帮助技能署名 Hermes Agent + Teknium，MIT。下方保留完整原文、表格、命令与示例。

Common "why is Hermes doing X to my output / tool calls / commands?" toggles — and the exact commands to change them. Most of these need a fresh session (`/reset` in chat, or start a new `hermes` invocation) because they're read once at startup.

### Secret redaction in tool output

Secret redaction is **on by default** — tool output (terminal stdout, `read_file`, web content, subagent summaries, etc.) is scanned for strings that look like API keys, tokens, and secrets before it enters the conversation context and logs. Leave it enabled for normal use:

```bash
hermes config set security.redact_secrets true       # keep enabled globally
```

**Restart required.** `security.redact_secrets` is snapshotted at import time — toggling it mid-session (e.g. via `export HERMES_REDACT_SECRETS=false` from a tool call) will NOT take effect for the running process. Tell the user to change it in config from a terminal, then start a new session. This is deliberate — it prevents an LLM from flipping the toggle on itself mid-task.

Disable only when you deliberately need raw credential-like strings for debugging or redactor development:
```bash
hermes config set security.redact_secrets false
```

### PII redaction in gateway messages

Separate from secret redaction. When enabled, the gateway hashes user IDs and strips phone numbers from the session context before it reaches the model:

```bash
hermes config set privacy.redact_pii true    # enable
hermes config set privacy.redact_pii false   # disable (default)
```

### Command approval prompts

By default (`approvals.mode: smart`), Hermes asks an auxiliary LLM to assess shell commands flagged as destructive (`rm -rf`, `git reset --hard`, etc.). The modes are:

- `smart` — auto-approve a low-risk command once, deny high-risk commands, and prompt when uncertain (default)
- `manual` — always prompt
- `off` — skip all approval prompts (equivalent to `--yolo`)

```bash
hermes config set approvals.mode smart       # recommended middle ground
hermes config set approvals.mode off         # bypass everything (not recommended)
```

Per-invocation bypass without changing config:
- `hermes --yolo …`
- `export HERMES_YOLO_MODE=1`

Note: YOLO / `approvals.mode: off` does NOT turn off secret redaction. They are independent.

### "Reset permissions" / "make Hermes ask again"

The user usually means: wipe the accumulated "Always allow" state — NOT yolo
mode, and NOT a per-edit diff prompt (which doesn't exist; file writes never
go through the approval prompt, only shell commands do). Two stores hold it:

1. Shell-command allowlist: `hermes config set command_allowlist '[]'`
2. Shell-hook consent (only if present): `rm -f ~/.hermes/shell-hooks-allowlist.json`

Then sanity-check `hermes config get approvals.mode` (should not be `off`)
and confirm `--yolo` isn't baked into their launch alias or systemd unit.

### Shell hooks allowlist

Some shell-hook integrations require explicit allowlisting before they fire. Managed via `~/.hermes/shell-hooks-allowlist.json` — prompted interactively the first time a hook wants to run.

### Disabling the web/browser/image-gen tools

To keep the model away from network or media tools entirely, open `hermes tools` and toggle per-platform. Takes effect on next session (`/reset`). See `references/configuration.md` for the toolset list.
