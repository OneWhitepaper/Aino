---
title: "Skill Installer — Install reviewed skills through the existing skill hub"
sidebar_label: "Skill Installer"
description: "Install reviewed skills through the existing skill hub"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Skill Installer

Install reviewed skills through the existing skill hub.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/skill-installer` |
| Version | `1.0.0` |
| Author | OpenAI, Aino contributors |
| License | Apache-2.0 |
| Platforms | linux, macos, windows |
| Tags | `skill-installer`, `software-development` |
| Related skills | [`skill-creator`](../../bundled/software-development/software-development-skill-creator.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Skill Installer Skill

Discover and install skills using Aino's established skill hub and profile-aware storage. Review source, licensing, dependencies, and installation results rather than copying arbitrary host-specific files.

## When to Use

Use when the user requests installing a named skill, enabling an official optional skill, or updating an existing installation.

## Prerequisites

- `terminal` with the existing `hermes skills` CLI, plus `skills_list` and `skill_view` for verification.
- A specific source/name or enough context to locate the intended project.
- Read and preserve user modifications, disabled skills, and the owning Bot/profile selection.

## How to Run

Use `hermes skills --help` to confirm supported source/install/update commands. The internal CLI name remains compatible in Aino; it does not change the product identity.

## Quick Reference

```text
hermes skills list
hermes skills install official/security/1password
hermes skills install owner/repository/skills/workflow
hermes skills install https://example.com/SKILL.md --name my-workflow
```

Examples identify source formats, not permission to install an unrelated skill. Use the exact user-requested source and the CLI's security review; never add `--force` merely to suppress warnings.

## Procedure

1. Resolve the intended skill/source and compare existing installations with `skills_list` before adding anything.
2. Review the source SKILL.md, scripts, dependency/install commands, license, and nested resources. Check for host-only tools, secrets, destructive actions, or unsupported services.
3. Select the owning Aino profile using the normal CLI/profile workflow; never move skills between profiles by changing process-global environment in a long-running service.
4. Install using the existing hub command with the appropriate source identifier. Follow required review/approval gates and preserve user-modified copies.
5. Confirm the complete skill package was installed, including referenced scripts/assets/licenses, and report external dependency setup still needed.
6. Verify `skill_view` reads it and its supporting files. Run a bounded offline smoke check where suitable.
7. Make it available through the existing refresh/new-session path. Do not rebuild past conversation prompts or toolsets to force activation.

## Pitfalls

- An optional catalog stub is not a complete installed capability.
- Do not globally install dependencies or copy a proprietary Codex package just because its files are readable.
- A failed install or partial resource download is not success.
- Avoid overwriting local edits and do not re-enable explicitly disabled skills without user intent.

## Verification

Confirm the installed name/source/profile, complete resources, platform readiness, and actual loading. Report any remaining CLI/MCP/account requirement and the invocation name.

## Attribution

Adapted from the OpenAI Apache-2.0 skill-installer; installation uses Aino's existing hub instead of Codex-specific directories.
