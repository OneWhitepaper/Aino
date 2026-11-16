---
name: chronicle
description: Explain authorized screen context and recent work.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [chronicle, autonomous-ai-agents]
    category: autonomous-ai-agents
    related_skills: [computer-use, control-in-app-browser]
---

# Screen Context Chronicle Skill

Build a grounded account of visible work from authorized current observations and user-supplied artifacts. This Aino-native workflow has no background screen recorder and cannot retrieve Codex's historical screen recordings.

## When to Use

Use when the user refers to the current desktop, asks what changed in supplied screenshots, or wants a chronology from available session evidence.

## Prerequisites

- `computer_use` for authorized current desktop capture, or `desktop_preview` / `drive_preview` for the chosen browser tab.
- User-provided screenshots, logs, or explicit permission to inspect a relevant app.
- Historical questions require actual supplied records; current screenshots cannot establish past actions.

## How to Run

Load `computer-use` with `skill_view` for desktop capture, or `control-in-app-browser` for a browser-only question. Use `read_file` for supplied logs and `vision_analyze` for available image files.

## Quick Reference

| Evidence | What it establishes |
| --- | --- |
| Current capture | Visible state now |
| Timestamped log | Recorded events in that source |
| User screenshot | State at the supplied capture |
| Chat context | What was requested or reported |

Keep observations separate from inferences.

## Procedure

1. Bound the app, time range, and question using existing user context.
2. Capture only the relevant authorized surface, avoiding unrelated private windows.
3. Read available records and record their actual timestamps and timezones.
4. Arrange supported events chronologically and explain causal links only when supported.
5. Identify missing evidence directly. Offer the next relevant observation instead of inventing an activity history.
6. Save a report only when requested; use current profile-aware artifact locations.

## Pitfalls

- Never turn this skill into continuous recording, telemetry, or hidden monitoring.
- Do not read another application's private database to simulate an unavailable recording service.
- Redact secrets and unrelated personal data from reports.

## Verification

Every factual claim must identify its screenshot, log, or conversation evidence. Confirm that the report labels unknown time ranges and does not present inference as observed history.
