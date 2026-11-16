---
title: "Product Design User Context — Capture user tasks, constraints and product evidence"
sidebar_label: "Product Design User Context"
description: "Capture user tasks, constraints and product evidence"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Product Design User Context

Capture user tasks, constraints and product evidence.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/product-design-user-context` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `product-design-user-context` |
| Related skills | [`product-design`](../../bundled/creative/creative-product-design.md), [`product-design-get-context`](../../bundled/creative/creative-product-design-get-context.md), [`product-design-research`](../../bundled/creative/creative-product-design-research.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Product Design User Context Skill

Build a practical picture of the people and situations a design must support. Use user-supplied and observed evidence, keep uncertain assumptions visible, and store only the context needed for the authorized product work.

## When to Use

- A new feature needs clear audience, jobs, expectations and constraints.
- Product decisions conflict because teams imagine different users.
- Existing research or direct feedback should inform a concrete design brief.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Review existing product/research material and the current workflow.
2. Identify the primary user, situation, desired outcome and obstacle.
3. Ask for the few missing facts that materially affect the design.
4. Produce task scenarios and acceptance checks, clearly separating evidence and assumptions.

## Quick Reference

| Question | Useful evidence | Design consequence |
|---|---|---|
| Who performs the task? | Role, experience, actual feedback | Language and control density |
| In what situation? | Device, interruptions, environment | Focus, recovery, input methods |
| What outcome matters? | Task description and completion evidence | Primary action and result |
| What gets in the way? | Observed failure or user report | State, hierarchy or recovery fix |
| What must stay private? | Account/data boundaries | Scope and storage choices |

## Procedure

### Read existing context
Use `read_file` to inspect supplied briefs, PRODUCT.md, support findings or research notes. Use `search_files` to find the current routes and relevant product terms. Record source date and scope. A developer's assumption and a user's observed difficulty are different evidence types.

### Describe users through tasks
Prefer concrete scenarios to demographic stereotypes. State the starting condition, intent, steps, interruptions, required information and completion criterion. Identify the main user and any collaborator or administrator whose permissions change the flow.

Separate novice onboarding from repeated expert use. Consider keyboard-only input, reduced vision, translated content, window constraints and network interruption when relevant to the real use case. Avoid claiming all populations are covered from a single example.

### Gather only material missing facts
Ask focused questions whose answers change navigation, terminology, disclosure, permissions or state. Reuse answers already provided. Avoid collecting credentials, unrelated personal details or sensitive research records merely to fill a persona template.

### Synthesize into constraints
Create a table of evidence → user need → design consequence → acceptance check. Rank blocked tasks and trust failures above visual preferences. Distinguish a recurring pattern from one anecdote; label confidence rather than manufacturing a score.

Write a short product-context note using [templates/user-task.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/product-design-user-context/templates/user-task.md). Store it in the user-approved project area, not another account's profile. Do not silently write personal information to a global memory store.

### Validate the proposed direction
Walk the scenario through the current or proposed UI. Does the user know what to do, see progress, recover from error and recognize completion? Check that simplifying onboarding does not remove advanced capabilities. Update conclusions when source evidence contradicts an assumption.

## Pitfalls

- Invented personas, interviews, quotations or usage statistics.
- Treating the requesting developer as every end user.
- Overcollecting private context or mixing data from separate accounts.
- Asking a long questionnaire before reading the available product evidence.

## Verification

Each main need cites an actual source or is labeled as an assumption. Scenarios have observable outcomes and map to specific controls or states. List unresolved context that would change the design; proceed with reasonable documented defaults where it would not.
