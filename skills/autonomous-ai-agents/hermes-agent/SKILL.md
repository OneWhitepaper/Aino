---
name: hermes-agent
description: "Use and troubleshoot Aino desktop and runtime."
version: 3.5.1
author: Hermes Agent + Teknium
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [aino, help, hermes, setup, configuration, multi-agent, cli, gateway, bots, desktop-plugins]
    homepage: https://github.com/OneWhitepaper/Aino
    related_skills: [claude-code, codex, opencode]
---

# Aino Help Skill

Help users operate and troubleshoot the installed Aino product. The bundled Aino documentation
contains the product guide and complete operating handbook, including all original help chapters
and templates. Read its local chapters for commands and extension contracts; upstream documentation
is not evidence of Aino UI availability.

## When to Use

- The user asks how to use an Aino page, model, Bot, group, file panel or setting.
- A connection, account, device authorization, model or tool needs diagnosis.
- The user wants MCP, plugins, skills, scheduling, messaging or desktop extensions.
- An old conversation still uses an earlier system prompt after a product update.

## Prerequisites

- Read the installed documentation before changing configuration.
- Use `skill_view` for the installed guides and `search_files` to locate implementation details.
- Use `terminal` only when a real command is needed.
- Confirm the owning account workspace, connection and profile before a state change.
- Never ask the user to paste passwords, API keys or device keys into chat.

## How to Run

1. Read `references/aino-help.md`, then load the matching guide with
   `skill_view(name="hermes-agent", file_path="aino-docs/README.md")`.
2. Replace `README.md` with a filename from the table below. For example, use
   `aino-docs/models-and-images.md` for models or `aino-docs/handbook/README.md` for the full handbook.
3. Resolve document links relative to the document being read and keep the `aino-docs/` prefix.
   A chapter linked from `aino-docs/handbook/README.md` as `references/configuration.md`
   is read with `file_path="aino-docs/handbook/references/configuration.md"`.
4. The existing `skill_view` channel reads bundled documentation on the running service's host,
   including when `terminal` uses SSH, Docker or another sandbox. Do not send the host's installed
   documentation path to a remote `read_file` or attempt to copy the installation into the sandbox.
5. Technical templates use the same channel, such as `aino-docs/handbook/templates/plugin.js`.
   For local source inspection only, the source-tree guides are in `docs/aino/`; the Python
   package carries them in `hermes_cli/data/aino-docs/`. Verify current command help or
   implementation before acting.

## Quick Reference

| Question | Aino guide filename |
| --- | --- |
| First login and first task | `getting-started.md` |
| Account isolation, device Key, permission and billing | `accounts-and-devices.md` |
| Ordinary chat, Bot, group, collaboration capsule | `conversations-and-collaboration.md` |
| Default model, third-party/custom API, images | `models-and-images.md` |
| File/preview tabs, terminal, review, summary, widgets | `files-and-panels.md` |
| Appearance, safety, memory, voice and advanced settings | `settings.md` |
| MCP, plugin, skill and approval | `extensions-and-safety.md` |
| Scheduled jobs, messaging and gateway | `scheduling-and-gateway.md` |
| Errors and safe recovery | `troubleshooting.md` |
| Controlled refresh of an old system prompt | `prompt-refresh.md` |
| Source and upstream-reference mapping | `feature-map.md` |
| Full original help, all technical chapters and templates | `handbook/README.md` |

The skill ID remains `hermes-agent` for compatibility. The product is Aino; `hermes`,
`HERMES_HOME`, `@hermes/plugin-sdk` and existing bridge/protocol names remain real technical
interfaces. Do not invent replacement `aino` commands or relabel actual third-party services.

## Procedure

1. Identify the user's concrete goal and the affected account, conversation and connection.
2. Read the matching local Aino guide. Separate product facts from preserved upstream examples.
3. Check availability without mutation: current model/configuration, connection state,
   installed capability, tool discovery or exact CLI `--help`, as appropriate.
4. Explain the smallest relevant cause in the user's terms, then use the existing recovery
   action or configuration flow within their authorized scope.
5. Keep changes scoped to the current conversation unless a saved default is explicitly
   requested. A temporary model selection must not silently change every Bot default.
6. Verify the requested behavior and report what was observed. A saved configuration,
   OAuth URL or queued request alone is not successful execution.

For MCP installation, use the existing `manage_connections` confirmation card when available.
Review real command/URL/environment names, keep secrets in dedicated fields, and distinguish
pending authorization from connected tools. Another application's plugin CLI is not Aino's installer.

For delegation, use existing `delegate_task` lifecycle and result return. The collaboration
capsule displays real child work from ordinary, Bot and group conversations; it does not create
another scheduler. Use supported source-bound controls instead of borrowing another Bot's session.

For prompt changes, preserve the conversation's cached prefix by default. Use new sessions,
or the explicit `hermes sessions refresh-prompts --session SESSION_ID` maintenance action in
the owning runtime scope when the user needs an old conversation refreshed. See the dedicated guide.

## Pitfalls

- Cloud conversation synchronization is retired. Do not restore sync UI, upload queues or
  cloud-recovery advice, and do not promise cross-device conversation restoration.
- A device Key identifies the account; built-in model permission and cost are determined
  per request. Switching models or subscriptions is not a reason to mint a plan-specific Key.
- Account ownership pending is not another account, but it is also not permission to send.
  Never claim nonempty historical sessions for the current login to bypass a recovery error.
- Image quality defaults to automatic and is separate from text reasoning intensity.
  Do not assert a universal official reasoning-level catalog that is not implemented.
- A gateway is a running service, not proof of Aino cloud hosting. Temporary child agents
  are not guaranteed to survive the owning runtime process exiting.
- Preserve user-created personas and history. Product branding is not permission to rewrite
  custom content, legal attribution, provider names or technical compatibility identifiers.
- Upstream service subscriptions have their own access and cost rules; Aino account access
  does not automatically include every Nous or third-party managed service.

## Verification

- Check the relevant local guide exists and matches the installed feature entry.
- For read-only answers, cite the local guide and clearly identify any remaining uncertainty.
- For a fix, verify the actual connection, model request, file, tool discovery or task result.
- Test failures and pending authorization are not success; do not hide them behind a new chat.
- Check state still belongs to the intended account/profile after navigation or re-login.
- Do not infer server deployment, billing success or universal availability from source alone.

All original help content is included in the Aino handbook: `handbook/runtime-guide.md`, nineteen
technical chapters and three templates. Each chapter explains its current Aino scope. Original
sources remain in this skill for compatibility and provenance, with authorship and license retained.
Read the installed Aino handbook first; the upstream installer and old UI examples are not the
current Aino onboarding flow.
