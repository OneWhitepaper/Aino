---
title: "Control In App Browser — Operate the selected Aino browser tab with observations"
sidebar_label: "Control In App Browser"
description: "Operate the selected Aino browser tab with observations"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Control In App Browser

Operate the selected Aino browser tab with observations.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/autonomous-ai-agents/control-in-app-browser` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `control-in-app-browser`, `autonomous-ai-agents` |
| Related skills | [`computer-use`](../../bundled/autonomous-ai-agents/autonomous-ai-agents-computer-use.md), [`playwright`](../../bundled/software-development/software-development-playwright.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Control In-App Browser Skill

Operate Aino's real embedded browser with its existing desktop tools. This workflow keeps the selected tab and its login state; it does not substitute an unrelated automated browser.

## When to Use

Use for visible web navigation, forms, page inspection, browser troubleshooting, and interactive acceptance tests in Aino.

## Prerequisites

- Aino desktop with `desktop_preview` and `drive_preview` available in this session.
- A clearly identified URL or selected tab. Vision requires the current model or configured auxiliary vision model.
- If desktop tools are absent, explain that limitation. `browser_exec` is a separate browser and does not inherit this tab's cookies.

## How to Run

Use `desktop_preview` to open or read the panel and `drive_preview` to observe and act. Use only arguments present in the current tool schema; examples below use the native tools directly.

## Quick Reference

```text
desktop_preview(action="open", url="https://example.com", label="Example")
drive_preview(action="tabs")
drive_preview(action="elements", tab_id="<returned tab>")
drive_preview(action="click", tab_id="<returned tab>", ref="<observed ref>")
drive_preview(action="screenshot", tab_id="<returned tab>")
```

| Need | Action / arguments |
| --- | --- |
| Read controls | `elements`, optionally `full=true` |
| Type / keyboard | `type` with `ref,text`; `press` with `key` |
| Visual fallback | `click` / `double_click` / `hover` with `coordinate,observation_id` |
| Drag | `drag` with `coordinate,to_coordinate,observation_id` |
| Switch tabs | `tabs`, then `select_tab` with exact `tab_id` |
| JavaScript dialogs | `dialog_status`, then `dialog_respond` with `dialog_id,accept` |
| Native file chooser | `upload_files` with approved absolute `paths` and observed `chooser_id` |
| Downloads | `downloads_status`; exact new `download_path` for approval; `download_cancel` |

## Procedure

1. Identify the owning conversation and tab; inspect tabs and current URL before acting. Open only the user's intended destination.
2. Observe `elements`. Prefer the observed role/name/reference. For canvas or inaccessible content, obtain a screenshot and use its pixel coordinates with the exact returned `tab_id` and `observation_id`.
3. Perform a small group of related actions and observe again. Refresh references after navigation, tab changes, dialogs, or substantial page updates.
4. For consequential submission, deletion, payment, account security, uploads, and downloads, use the existing approval flow and `sensitive=true` where applicable. Existing explicit user authorization determines scope; never bypass a refusal through script injection.
5. On a CAPTCHA or user-only authentication step, preserve the tab and hand control to the user. Resume after confirming the visible outcome.
6. Verify the intended page or saved result. Keep the panel available for review; close only task-owned temporary tabs when useful.

## Pitfalls

- A stale reference or screenshot must be observed again, never guessed or silently rescaled.
- Dialog acceptance is a browser action, not a substitute for user authorization.
- Do not inject JavaScript to read passwords, bypass confirmations, or operate an unrelated tab.
- Popup/detach should preserve the same tab state; unexpected reloads are failures to report.

## Verification

Confirm the final URL, selected tab, and observable result after the last action. In acceptance work also test user takeover, cancellation, approval rejection, and restoration to the conversation without losing page state.
