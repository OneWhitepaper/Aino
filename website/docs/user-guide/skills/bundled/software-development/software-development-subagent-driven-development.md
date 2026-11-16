---
title: "Subagent Driven Development — Execute a plan with scoped agents and checked results"
sidebar_label: "Subagent Driven Development"
description: "Execute a plan with scoped agents and checked results"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Subagent Driven Development

Execute a plan with scoped agents and checked results.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/subagent-driven-development` |
| Version | `1.0.0` |
| Author | Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `delegation`, `implementation`, `review`, `integration` |
| Related skills | [`dispatching-parallel-agents`](../../bundled/software-development/software-development-dispatching-parallel-agents.md), [`executing-plans`](../../bundled/software-development/software-development-executing-plans.md), [`requesting-code-review`](../../bundled/software-development/software-development-requesting-code-review.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Subagent-Driven Development Skill

Execute reviewable deliverables through Aino's native child-agent lifecycle.
Give each implementer a bounded task, review spec compliance and code quality,
and verify the complete integrated change.

## When to Use

- An agreed implementation plan has separable deliverables.
- Focused child contexts can reduce investigation or implementation load.
- A controller can own integration and validate each result.

Use inline execution for a small tightly coupled edit. Use
`dispatching-parallel-agents` for independent concurrent work.

## Prerequisites

- The plan, its specification, and current repository state.
- Native `delegate_task` and its advertised concurrency/depth limits.
- Explicit file/resource ownership and known dependency order.
- Native file tools, `terminal`, and `todo` when available.

## How to Run

1. Inspect the plan and recover the actual execution state.
2. Brief a fresh implementer for each substantial deliverable.
3. Inspect the returned work and request a bounded task review.
4. Fix confirmed findings and verify the integrated result.

Use [references/implementer-brief.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/subagent-driven-development/references/implementer-brief.md) and
[references/task-reviewer-brief.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/subagent-driven-development/references/task-reviewer-brief.md)
for task-specific context. Fill them with real requirements and paths.

## Quick Reference

| Role | Responsibility |
| --- | --- |
| Controller | Scope, task ownership, integration, progress, final evidence |
| Implementer | Bounded deliverable, focused checks, self-review, factual report |
| Task reviewer | Independent spec and quality review of the actual task diff |
| Final reviewer | Whole-change contracts, omissions, and integration risks |

The controller dispatches reviewers. A reviewer does not recursively create
another review tree.

## Procedure

### Prepare a recoverable execution state

Read the complete plan and specification. Verify actual interfaces, shared
files, global constraints, and acceptance criteria before dispatching.

Identify the correct repository, branch, and worktree. Reuse a suitable
isolated checkout. Preserve unrelated changes and their staging.

For a long plan, keep a scoped progress record beside its established plan
artifacts: plan identity, task state, decisions, changed files, checks, and
open findings. Inspect this record and actual source after resumption so
completed work is not redispatched. Use `todo` as a concise active summary.

### Create bounded implementation briefs

Read the relevant code yourself so the child receives sufficient context.
Include exact scope, constraints, file ownership, dependencies, inputs and
outputs, meaningful tests, and the required final report.

Use `delegate_task(tasks=[...])`; each task has a `goal`, optional
`display_name`, and explicit `context`. Default isolated context is useful,
but include relevant prior user requirements through the supported
`context_turns` option when needed.

Keep configured model defaults unless the user or task requires a supported
override. Do not introduce hidden provider selection, toolset parameters,
a parallel scheduler, or persistent Bots.

Dispatch a fresh implementer for a substantial independent deliverable.
Batch several identical small edits in one brief when they share the same
review surface. Parallelize only disjoint work with stable interfaces.

### Let native lifecycle own coordination

The runtime owns child identity, profile scope, execution, and result return.
Use returned identifiers and the advertised list/steer/stop controls.

For a running child, send a precise course correction through
`delegate_task(action="steer", subagent_id="...", message="...")`.
For additional work after a child finishes, create a bounded new task with
the prior report and required files; do not assume a completed child can
resume through a live-control action.

Continue independent controller work while waiting. Use native result
delivery and meaningful status checks. Do not poll rapidly or mutate
global profile state to control a child.

### Review each deliverable

Inspect the result, actual diff, and check evidence. Confirm the child
stayed within its assigned scope and did not overwrite another task's work.

Request a read-only task review covering both specification and quality.
Give the reviewer requirements, constraints, real paths/range, and actual
test results. The reviewer should inspect adjacent consumers where needed.

Validate findings before accepting them. Repair confirmed issues, rerun
affected checks, and request focused re-review when risk or changes warrant
it. Record reasoned dispositions for disputed or out-of-scope observations.

If a task contradicts the accepted spec, correct the task using that spec
and record the decision. Material missing product decisions or actual
authorization boundaries need user input; routine choices do not.

### Integrate and complete

Once a task is genuinely verified, update the progress record before
dispatching dependent work. Check exact names, types, state ownership,
migration order, and error semantics between tasks.

After all deliverables, request one broad whole-change review when warranted.
Run the required integrated checks using
`verification-before-completion`. A child's passing focused test does not
prove the combined system works.

Perform commits, pushes, merges, or publication only within existing user
authorization. Preserve worktrees and artifacts needed for feedback or
recovery; completion is not automatic permission to delete them.

## Pitfalls

- Delegating without reading enough source to specify the task.
- Giving children overlapping files or shared UI control.
- Following an outdated plan over the user's accepted requirement.
- Treating a child report or reviewer verdict as final evidence.
- Repeatedly redispatching completed tasks after compaction.
- Creating an alternate delegation/profile manager.

## Verification

Each deliverable has inspectable files, actual checks, and resolved material
findings. The final report describes the integrated outcome, native
delegation limits encountered, and any acceptance step still unavailable.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/subagent-driven-development).
The upstream MIT notice is included in `LICENSE`.
