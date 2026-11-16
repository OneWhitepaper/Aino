---
name: executing-plans
description: Carry out a plan with checked, traceable progress.
version: 1.0.0
author: Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [execution, plans, progress, integration]
    category: software-development
    related_skills: [writing-plans, verification-before-completion, requesting-code-review]
---

# Executing Plans Skill

Execute an agreed plan in dependency order while keeping evidence and
progress recoverable. Resolve routine implementation choices within scope
and keep moving until the authorized outcome is complete.

## When to Use

- An implementation plan is ready and work should happen inline.
- A multi-step task resumes after interruption or context compaction.
- Integration needs explicit checkpoints across dependent changes.

## Prerequisites

- The plan and its referenced design or specification.
- Current user instructions, area instructions, and actual repository state.
- Native file tools, `terminal`, and `todo` when available.
- A suitable checkout and project-managed runtime for verification.

## How to Run

1. Read the plan critically against the spec and current source.
2. Verify the execution location and recover prior completed work.
3. Implement tasks in dependency order, checking each deliverable.
4. Review and verify the integrated result, then take authorized next steps.

## Quick Reference

| Checkpoint | Record |
| --- | --- |
| Start | Plan, branch/worktree, scope, baseline, existing changes |
| Task ready | Dependencies available and file ownership clear |
| Task complete | Actual change, checks, evidence, open limitations |
| Plan adjustment | Decision, reason, compatibility consequence |
| Integration | Whole-result review and required verification |

## Procedure

### Validate the plan

Read the full plan and referenced spec. Inspect the actual files and relevant
history. A plan is an argument for implementing the spec, not authority to
override the user or repository rules.

Look for contradictory task requirements, stale paths, interface mismatches,
missing consumers, and tests that fail to prove the promised behavior.
Correct routine defects using the accepted design and record the adjustment.

If a material product decision is missing, ask for that decision while
continuing independent work. If the plan would require an unauthorized
external or destructive action, complete reviewable preparation first.

### Establish the execution state

Verify repository root, branch, worktree, and local changes. Reuse a suitable
existing isolated checkout; `using-git-worktrees` applies when isolation is
needed. Preserve unrelated user changes and their staging.

Inspect any progress record and the actual diff or commits before restarting.
Mark a task complete only when its deliverable and verification are present.
Do not repeat completed tasks after compaction.

For a long plan, use its established progress location to record task status,
decisions, checks, and remaining blockers. `todo` can summarize active steps;
it should not be the sole record of a large resumable implementation.

### Execute coherent tasks

Work in dependency order. Read area instructions before editing and reuse
existing modules or extension points.

For behavior changes, follow `test-driven-development` when appropriate:
demonstrate the required failure, implement the shared fix, and verify it.
Use proportionate direct inspection for low-impact changes.

Run task-specific checks before dependent tasks consume the result. If a
check fails, investigate the failure instead of silently marking progress.
Distinguish baseline failures from new ones using an isolated comparison
when necessary.

Record what actually changed, meaningful deviations from the plan, and the
checks that ran. Do not perform a commit, push, merge, or release merely
because a generic plan template includes one; follow existing authorization.

### Keep execution moving

Batch independent reads and use `dispatching-parallel-agents` if bounded
independent work can run safely within available limits. Serialize edits
that share state, files, UI control, or dependent interfaces.

Continue through already authorized tasks without asking “should I continue?”
between steps. Provide concise progress updates focused on findings,
decisions, and what the next check resolves.

If a genuine dependency blocks one path, complete the remaining independent
tasks and preserve a precise handoff for the blocked step.

### Integrate and finish

Inspect the complete diff, resolve cross-task inconsistencies, and perform
an independent review when the scope warrants it. Use
`verification-before-completion` for final claims.

Confirm all acceptance conditions, migration behavior, and supported checks.
Then use `finishing-a-development-branch` for the requested integration
action. Do not claim deployment or merge without checking its final state.

## Pitfalls

- Executing stale instructions without looking at the current code.
- Starting another checkout despite already being in the correct worktree.
- Repeating completed work after losing conversational context.
- Skipping failing checks to keep the progress record green.
- Forcing arbitrary pauses or approvals after every batch.
- Calling the plan complete while a required integration step remains.

## Verification

Each completed task has an actual deliverable and evidence. The final
integrated checks cover interactions between tasks, and the report clearly
separates completed work from any remaining external or platform limit.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/executing-plans).
The upstream MIT notice is included in `LICENSE`.
