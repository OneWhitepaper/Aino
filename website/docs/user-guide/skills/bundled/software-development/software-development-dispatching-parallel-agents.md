---
title: "Dispatching Parallel Agents — Delegate independent tasks with clear ownership"
sidebar_label: "Dispatching Parallel Agents"
description: "Delegate independent tasks with clear ownership"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Dispatching Parallel Agents

Delegate independent tasks with clear ownership.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/dispatching-parallel-agents` |
| Version | `1.0.0` |
| Author | Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `delegation`, `parallelism`, `investigation`, `coordination` |
| Related skills | [`subagent-driven-development`](../../bundled/software-development/software-development-subagent-driven-development.md), [`systematic-debugging`](../../bundled/software-development/software-development-systematic-debugging.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Dispatching Parallel Agents Skill

Use concurrent child agents for work that is genuinely independent.
Give each child a bounded goal, sufficient context, and clear resource
ownership, then review and integrate the results.

## When to Use

- Separate failures involve unrelated components or causes.
- Independent read-only investigations can proceed at the same time.
- Disjoint implementation tasks have stable interfaces and separate files.

Use one investigator for related symptoms with a likely shared cause.
Serialize tasks that depend on another's output or control the same UI,
account, stateful service, or files.

## Prerequisites

- Native `delegate_task` is available in the current session.
- Known concurrency/depth limits from the advertised tool description.
- Explicit task boundaries, shared constraints, and integration ownership.
- Repository and area instructions for every delegated edit.

## How to Run

1. Partition by independent cause or deliverable.
2. Prepare complete bounded briefs with disjoint resource ownership.
3. Dispatch a batch through `delegate_task(tasks=[...])`.
4. Gather native results, review actual changes, and verify integration.

## Quick Reference

| Suitable for concurrency | Keep sequential |
| --- | --- |
| Read-only reviews of unrelated modules | A consumer awaiting its new API |
| Fixes in disjoint files with stable interfaces | Several edits to one stateful component |
| Independent fixture or data investigations | Shared browser or desktop control |
| Public documentation research | A migration and its in-place user data |

## Procedure

### Check independence and capacity

Group failures by likely cause rather than by test filename alone. A shared
fixture, global store, lifecycle, or configuration may explain several
failures. Investigate that boundary before assigning competing fixes.

Account for current children and the runtime's actual limits. Avoid
launching extra tasks merely because the batch accepts an array.
Do not create another scheduler or spawn subprocess agents.

### Build self-contained briefs

Each child needs:

- A specific goal and acceptance condition.
- Required background, exact paths, repro or evidence, and relevant decisions.
- Files/resources it may edit and resources owned by other tasks.
- Constraints, existing interfaces, and the supported verification command.
- A requested report: cause, changed files, checks, results, limitations.
- An instruction to report material discoveries before broadening scope.

Do not send unrelated conversation history or secrets. Use `context` for
task-specific facts and `context_turns` only when prior user messages
matter. Omit model or reasoning overrides unless the task or user requires
them and the current schema supports them.

Example native payload for independent read-only tasks:

```json
{
  "tasks": [
    {
      "goal": "Inspect the session restore path; report concrete causes of duplicate rows without editing files.",
      "display_name": "Session restore review",
      "context": "Read the repository instructions and the supplied reproduction. Scope: session persistence and restore only.",
      "context_turns": "none"
    },
    {
      "goal": "Inspect avatar rendering during pause/resume; report a reproducible cause without editing files.",
      "display_name": "Avatar lifecycle review",
      "context": "Read the repository instructions and the supplied reproduction. Scope: message identity and avatar ownership only.",
      "context_turns": "none"
    }
  ]
}
```

Replace example context with the real paths, evidence, and constraints.
If B needs A's output, dispatch B after A returns; grouping does not order them.

### Coordinate through the native lifecycle

Use returned child identifiers. Native control actions include
`delegate_task(action="list")`,
`delegate_task(action="steer", subagent_id="...", message="...")`, and
`delegate_task(action="stop", subagent_id="...")`.

Use steering for discovered constraints or ownership conflicts. A stop
returns partial work; inspect the diff before assigning a replacement.
Do not mutate global profile state to impersonate a child.

While children work, perform independent integration preparation.
Use native result delivery and occasional status checks when needed,
rather than a rapid polling loop.

### Review and integrate

Read each report and inspect actual files or patches. Check for overlapping
edits, inconsistent assumptions, weakened tests, and missing consumers.

Confirm the reported checks ran against the right state. Run relevant
combined checks after integration because individually passing changes can
still conflict.

If delegation is unavailable, execute the bounded tasks inline and explain
the capability limit if it affects time or independent review.

## Pitfalls

- Assigning every failure to a child before checking for a shared cause.
- Giving a goal without paths, expected behavior, or resource ownership.
- Letting children edit the same files or drive the same browser.
- Assuming a result bucket creates an execution dependency.
- Treating a child summary as proof of the integrated result.
- Replacing Aino's native lifecycle with a parallel manager.

## Verification

Every task has an owned deliverable and evidence; overlapping changes are
resolved and integration checks pass. Report unfinished or stopped tasks
accurately, including partial files that still need inspection.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents).
The upstream MIT notice is included in `LICENSE`.
