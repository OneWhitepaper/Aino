---
name: requesting-code-review
description: Get evidence-based review before integrating changes.
version: 2.2.0
author: Jesse Vincent (@obra), MorAlekss; Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [code-review, verification, quality, integration]
    category: software-development
    related_skills: [receiving-code-review, subagent-driven-development, verification-before-completion]
---

# Requesting Code Review Skill

Request an independent, scoped review of a meaningful change before it is
integrated. Give the reviewer the actual requirements, exact diff, and
evidence so findings concern real behavior rather than personal preferences.

## When to Use

- A feature, important fix, migration, or refactor is ready for review.
- The user explicitly asks for review before commit, push, or merge.
- A task in `subagent-driven-development` needs spec and quality review.
- Integrated changes need a broad check beyond each task's local tests.

## Prerequisites

- The task requirements, area instructions, and relevant design.
- Exact review scope: working diff, staged diff, or known base/head commits.
- Native `delegate_task` for an independent reviewer, when available.
- `terminal`, `read_file`, and `search_files` for evidence and inspection.

## How to Run

1. Identify the exact diff and its acceptance criteria.
2. Run the relevant required checks and record actual outcomes.
3. Brief a reviewer using [references/reviewer-brief.md](references/reviewer-brief.md).
4. Validate findings, repair confirmed issues, and recheck changed behavior.

## Quick Reference

| Review input | Why it matters |
| --- | --- |
| User requirement/spec | Establishes intended behavior |
| Base and head or exact working diff | Prevents reviewing the wrong change |
| File and area instructions | Supplies architectural and test contracts |
| Validation evidence | Separates tested behavior from assumptions |
| Baseline failures | Prevents misattributing unrelated defects |
| Known limitations | Makes the final acceptance decision explicit |

## Procedure

### Identify the reviewable change

Inspect repository state and the user's requested scope. Use the relevant
`git diff`, `git diff --cached`, or explicit revision range through
`terminal`. An empty staged diff does not mean there is nothing to review.

Confirm the baseline and target branch before selecting a range. Include
new files and integration changes that a plain tracked diff may omit.
Split a large review by coherent feature boundaries while keeping shared
contracts and the whole-change acceptance criteria visible.

Do not require the user to stage files before a read-only review. Do not
change staging, stash their work, or choose an unrelated previous commit
merely to produce a nonempty diff.

### Establish validation evidence

Run the project's relevant tests and required checks. Record the exact
commands, revision, results, and material skips. If a baseline comparison is
needed, use an isolated checkout or other non-destructive project workflow.

Review the changed trust boundaries and data flows for concrete concerns:
ownership, authorization, input interpretation, secret exposure, persistence,
cancellation, retries, concurrency, and migration. Do not infer a finding
from a keyword alone or mandate an unrelated security audit.

### Dispatch an independent reviewer

Use `delegate_task(tasks=[...])` with a bounded read-only goal. Include
the requirements, absolute checkout path, exact review range or file list,
verification evidence, known limits, and the linked reviewer brief.

Ask the reviewer to inspect the real code and adjacent consumers, not merely
repeat the implementer's summary. For a task review, check spec compliance
and code quality in the same bounded review. For a final review, inspect
cross-task contracts and integrated behavior.

Do not let reviewers recursively spawn more reviewers or edit files unless
that extra role is explicitly part of the assignment. The controller owns
fixes and integration.

If delegation is unavailable, perform an explicit self-review and state that
independent review was unavailable. Do not label a self-review independent.

### Evaluate and repair findings

For each finding, verify the premise, affected code path, and practical
impact. A useful finding includes a location, trigger, expected versus
actual behavior, and evidence or a testable explanation.

Fix confirmed blockers and material regressions before integration. Use
`receiving-code-review` to assess uncertain or disputed comments. A
preference that conflicts with the accepted design needs discussion or a
reasoned disposition rather than automatic implementation.

Keep fixes scoped. Rerun affected checks and request a focused re-review
when the change or unresolved risk warrants it. Avoid unbounded review
loops, but never mark a mandatory correctness gap resolved without evidence.

### Finish within the authorized scope

Summarize confirmed findings, repairs, remaining limitations, and check
results. Use `finishing-a-development-branch` for integration only when
the user requested it.

Review does not authorize staging everything, committing, pushing, merging,
publishing, or messaging another person. Preserve existing authorization
and avoid redundant questions where the user already specified the action.

## Pitfalls

- Reviewing an old revision or omitting new files.
- Treating keyword matches or style preferences as proven defects.
- Hiding baseline failures or filtering out diagnostic output.
- Accepting a reviewer verdict without evaluating its evidence.
- Automatically running broad audits unrelated to the change.
- Automatically staging and committing every local modification.

## Verification

The final change satisfies the specification, confirmed material findings
are resolved, and relevant checks ran after repairs. Keep the distinction
between independent review, self-review, executed tests, and untested limits.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/requesting-code-review)
and the existing MorAlekss review workflow. The upstream MIT notice is in `LICENSE`.
