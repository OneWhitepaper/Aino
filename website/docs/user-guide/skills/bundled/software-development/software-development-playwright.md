---
title: "Playwright — Automate browser flows with observed element references"
sidebar_label: "Playwright"
description: "Automate browser flows with observed element references"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Playwright

Automate browser flows with observed element references.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/playwright` |
| Version | `1.0.0` |
| Author | Microsoft, OpenAI, Aino contributors |
| License | Apache-2.0 |
| Platforms | linux, macos, windows |
| Tags | `playwright`, `software-development` |
| Related skills | [`control-in-app-browser`](../../bundled/autonomous-ai-agents/autonomous-ai-agents-control-in-app-browser.md), [`frontend-testing-debugging`](../../bundled/software-development/software-development-frontend-testing-debugging.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Playwright Skill

Operate a separate real browser using Playwright CLI, with fresh snapshots and reviewable artifacts. For the user's existing Aino browser tab and login state, use `control-in-app-browser` instead.

## When to Use

Use for UI-flow debugging, reproducible browser checks, form filling, screenshots, traces, and data extraction in an explicitly scoped test browser.

## Prerequisites

- `terminal` and Node.js/npm; inspect `node --version`, `npm --version`, and the repository's existing Playwright setup.
- Prefer an installed `playwright-cli` or the project's locked dependency. If absent, install the CLI/browser only in an authorized local development environment following https://github.com/microsoft/playwright-cli.
- Do not install globally or use an implicit network download merely to inspect available commands.

## How to Run

Run `playwright-cli --help` through `terminal` to confirm supported commands. The examples use the installed CLI; a project's existing package-manager command may provide the same binary.

## Quick Reference

```text
playwright-cli open https://example.com --headed
playwright-cli snapshot
playwright-cli click e3
playwright-cli snapshot
playwright-cli screenshot
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli close
```

Full command reference: `references/cli.md`. Practical examples: `references/workflows.md`.

## Procedure

1. Confirm the target URL, task authorization, test data, and session ownership. Prefer a local fixture for destructive or approval scenarios.
2. Open the target and take a snapshot. Choose references from the current snapshot rather than guessing selectors.
3. Act using click/fill/type/press and observe again after navigation, major DOM updates, tabs, or dialogs. Refresh stale references rather than falling back to arbitrary JavaScript.
4. Use headed mode when the user's participation or visual review is needed. Keep credentials out of screenshots, traces, and committed artifacts.
5. Capture console/network errors, screenshots, and tracing evidence that explain the observed failure. Use project output paths and descriptive filenames.
6. For a requested regression suite, extend the project's existing Playwright test setup; a one-off browser check does not require adding a test framework.
7. Close only the owned session after verification. Report the actual flow outcome and any external-service failures separately.

## Pitfalls

- Playwright browser state and the Aino embedded browser are separate; do not claim they share cookies.
- Snapshot references expire after significant page updates.
- Avoid `eval`/`run-code` when semantic operations suffice; never use them to bypass approval.
- A screenshot alone does not establish that a submitted form was saved.

## Verification

Verify destination/content after each meaningful action and assert the intended final state. Retain the relevant screenshot/trace and confirm temporary browser sessions are closed.

## Attribution

Adapted from the Apache-2.0 Playwright skill; Microsoft notice is included in NOTICE.txt.
