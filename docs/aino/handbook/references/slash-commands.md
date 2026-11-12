# Aino 技术参考 · Slash Commands (In-Session)

> **Aino 适用范围**：本章完整列出运行时斜杠命令，包含 CLI、网关与可选入口，不能据此声称桌面全部提供。原文的 `/stop` 描述 CLI 后台进程语义；Aino 桌面的暂停/继续按钮是当前任务控制，不能混同。`/skin` 只适用于 CLI/TUI；Aino 桌面使用固定品牌配色。
>
> 本文中的 Hermes 代表 Aino 复用的底层兼容运行时；命令、模块、路径示例和协议名按技术接口保留。
> 当前产品说明：[会话与协作](../../conversations-and-collaboration.md)、[设置](../../settings.md)、[模型与生图](../../models-and-images.md)。
> 来源：`skills/autonomous-ai-agents/hermes-agent/references/slash-commands.md`；原帮助技能署名 Hermes Agent + Teknium，MIT。下方保留完整原文、表格、命令与示例。

Registry of record: `hermes_cli/commands.py` (`COMMAND_REGISTRY`) — every
consumer (autocomplete, `/help`, Telegram menu, Slack mapping) derives from
it. New commands land often; `/help` in-session is always authoritative.
(CLI) = interactive CLI/TUI only. (GW) = gateway platforms only.

### Session
```
/new (/reset) [name]     Fresh session
/clear                   Clear screen + new session (CLI)
/retry                   Resend last message
/undo [N]                Back up N user turns and re-prompt
/title [name]            Name the session
/prompt (/compose)       Compose next prompt in $EDITOR (CLI)
/compress (/compact)     Compress context ('here [N]' keeps N turns; --preview)
/stop                    Kill background processes
/rollback [N]            List/restore filesystem checkpoints
/diff [mode] [--stat]    Git changes in cwd (staged|all|session modes)
/snapshot [sub]          Create/restore Hermes config+state snapshots (CLI)
/bg <prompt>              Run a prompt in a separate background session
/btw <question>           Ask a side question about the current conversation without interrupting it
/queue (/q) <prompt>     Queue prompt for next turn
/steer <prompt>          Inject a message after the next tool call
/agents (/tasks)         Show active agents and running tasks
/goal [text|sub]         Standing goal across turns (status|pause|resume|clear)
/subgoal [text]          Add/manage criteria on the active goal
/branch (/fork) [name]   Branch the session
/resume [name]           Resume a named session
/sessions                Browse and resume previous sessions
/handoff <platform>      Hand live session off to a messaging platform (CLI)
/status                  Session, model, token, and context info
/redraw                  Force full UI repaint (CLI)
```

### Configuration
```
/config                  Show config (CLI)
/model [name] [--global] Switch model (session-scoped by default)
/personality [name]      Set a personality
/reasoning [level|show|hide] Reasoning effort/display (none..xhigh|max|ultra)
/fast [normal|fast]      Priority/fast processing tier
/verbose                 Cycle tool progress: off → new → all → verbose → log (CLI)
/voice [on|off|tts]      Voice mode
/yolo                    Toggle approval bypass
/busy [queue|steer|interrupt] How messages behave while working (CLI + gateway)
/indicator [style]       TUI busy indicator: kaomoji|emoji|unicode|ascii (CLI)
/footer [on|off]         Gateway runtime-metadata footer on replies
/skin [name]             Change theme (CLI)
/statusbar (/sb)         Toggle status bar (CLI)
/battery [on|off]        Battery indicator in status bar (CLI)
/timestamps (/ts) [on|off] Message timestamps (CLI)
/codex-runtime [auto|codex_app_server] Codex runtime toggle
```

### Tools & Skills
```
/tools [list|enable|disable] Manage tools (CLI)
/toolsets                List toolsets (CLI)
/skills                  Search/install/manage skills (CLI)
/bundles                 List skill bundles (/<name> loads several skills)
/learn <source>          Learn a reusable skill from dirs/URLs/this chat
/memory [pending|approve|reject] Review pending memory writes / approval gate
/pet [toggle|list|<slug>] Petdex mascot control (CLI)
/hatch [description]     Generate a new pet from a description (CLI)
/cron [sub]              Manage scheduled tasks (CLI)
/suggestions (/suggest)  Review suggested automations
/blueprint (/bp) [name]  Set up an automation from a blueprint
/curator [sub]           Skill maintenance (status, run, pin, archive, …)
/kanban [sub]            Multi-profile collaboration board
/moa <prompt>            One prompt through the Mixture-of-Agents preset
/reload                  Reload .env into the running session (CLI)
/reload-mcp              Reload MCP servers
/reload-skills           Re-scan skills directory
/browser [connect|status] CDP connection to your live browser (CLI)
/plugins                 List plugins (CLI)
```

### Gateway
```
/approve [session|always]  Approve a pending dangerous command (GW)
/deny [all] [reason]       Deny a pending dangerous command (GW)
/restart                   Restart gateway after draining active runs (GW)
/sethome                   Set current chat as home channel (GW)
/topic [off|help]          Telegram DM topic sessions (GW)
/platform <pause|resume|list> Pause/resume a failing platform (GW)
/commands [page]           Browse all commands, paginated (GW)
```

### Info
```
/help                    Show commands
/usage [reset]           Token usage and rate limits
/insights [days]         Usage analytics
/whoami                  Slash-command access level (admin/user)
/profile                 Active profile info
/platforms (/gateway)    Platform connection status (CLI)
/journey (/learning)     Learned skills + memories timeline (CLI)
/subscription (/upgrade) Nous plan info (CLI)
/topup                   Nous balance / billing
/copy [N]                Copy last response to clipboard (CLI)
/paste                   Attach clipboard image (CLI)
/image <path>            Attach a local image file (CLI)
/update                  Update Hermes to latest
/version (/v)            Show version
/debug [nous|local]      Upload debug report, get shareable links
```

### Exit
```
/quit (/exit) [--delete] Exit CLI; --delete also removes session history
```
