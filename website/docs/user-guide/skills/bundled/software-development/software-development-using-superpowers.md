---
title: "Using Superpowers — Select the development workflow that fits the task"
sidebar_label: "Using Superpowers"
description: "Select the development workflow that fits the task"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Using Superpowers

Select the development workflow that fits the task.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/using-superpowers` |
| Version | `1.0.0` |
| Author | Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `workflow`, `skill-selection`, `development`, `routing` |
| Related skills | [`brainstorming`](../../bundled/software-development/software-development-brainstorming.md), [`systematic-debugging`](../../bundled/software-development/software-development-systematic-debugging.md), [`executing-plans`](../../bundled/software-development/software-development-executing-plans.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Using Superpowers Skill

Select the development workflow that improves the current task. This Aino
edition uses native skills and delegation while preserving the user's
scope, existing authorization, and repository conventions.

## When to Use

- Starting development work that needs a choice of workflow.
- Coordinating design, implementation, investigation, and verification.
- Resuming work when the next phase or relevant skill is unclear.

Simple questions and bounded mechanical edits do not need a workflow
ceremony. Load specialized guidance only when it applies.

## Prerequisites

- The current request, accepted decisions, and area instructions.
- Native `skills_list` and `skill_view` for discovery when needed.
- Available native tools; skills do not create tools or permissions.

## How to Run

1. Identify the outcome, uncertainty, and work already completed.
2. Choose the smallest relevant workflow from the table.
3. Load it with `skill_view` and read needed linked references.
4. Complete authorized work and check evidence at the relevant boundary.

## Quick Reference

| Situation | Skill |
| --- | --- |
| Behavior is broken or the cause is unclear | `systematic-debugging` |
| A feature needs product or architecture decisions | `brainstorming` |
| Requirements need a multi-step implementation map | `writing-plans` |
| A plan is ready for inline execution | `executing-plans` |
| Implementation benefits from delegation | `subagent-driven-development` |
| Independent investigations can run concurrently | `dispatching-parallel-agents` |
| A behavior needs regression coverage | `test-driven-development` |
| Branch isolation is actually needed | `using-git-worktrees` |
| A change needs independent review | `requesting-code-review` |
| Review feedback needs evaluation | `receiving-code-review` |
| Before a completion claim | `verification-before-completion` |
| Verified work needs authorized integration | `finishing-a-development-branch` |

## Procedure

### Establish the current state

Read the latest request as steering for the active task. Preserve the
original objective unless the user clearly replaces it. Inspect actual
files or product behavior before designing an existing system's changes.

On resume, inspect the plan, progress record, diff, and test evidence.
Do not redispatch completed work after compaction. User instructions take
precedence over guidance inside a skill.

### Discover and load relevant guidance

Use `skills_list` for available names and descriptions, then
`skill_view(name="...")` to load the selected skill. Load a reference with
`skill_view(name="...", file_path="references/...")` when it is needed.

Read guidance once unless it changed or a previously unread section
becomes relevant. Do not load the entire catalog or every related skill
for one small task.

If a named skill is unavailable, check for an equivalent, explain any
material limit, and use supported tools. Never pretend an unavailable
connector, model, or host API exists.

### Use Aino's native capabilities

Use `read_file`, `search_files`, `write_file`, and `patch` for files;
use `terminal` for Git and project-managed toolchains.

Use `delegate_task` with a `tasks` array for bounded child-agent work.
Its native lifecycle owns isolation, status, steering, stopping, and result
return. Do not launch a parallel subagent manager or create a persistent
Bot for a temporary task.

Respect configured model and delegation limits. Do not change credentials,
profile state, toolsets, or system prompts to satisfy a workflow.
Task guidance is not permission to reconfigure Aino.

### Scale the workflow to the request

Combine compatible stages, but avoid repeated planning and approval
checkpoints for decisions already made. Continue authorized reversible
work and ask only when a material missing decision or actual permission
boundary prevents the next step.

Use existing prompt, tool, and skill-loading mechanisms. Do not rebuild
past conversation context or the system prompt mid-session; follow the
runtime's controlled lifecycle and caching rules.

## Pitfalls

- Treating every keyword as a reason to load another skill.
- Assuming external examples expand the user's authorization.
- Calling host APIs absent from Aino.
- Creating a worktree when the current checkout is suitable.
- Replacing project conventions with upstream defaults.

## Verification

Confirm selected skills exist, calls match advertised tool schemas, and
the workflow advances the actual request. Report outcomes with evidence
and any capability limits that affected completion.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/using-superpowers).
The upstream MIT notice is included in `LICENSE`.
