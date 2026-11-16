---
name: writing-plans
description: Map agreed requirements into verifiable implementation.
version: 1.0.0
author: Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [planning, implementation, decomposition, requirements]
    category: software-development
    related_skills: [brainstorming, executing-plans, subagent-driven-development]
---

# Writing Plans Skill

Turn agreed requirements into a plan another engineer can execute without
guessing the interfaces or acceptance conditions. Decompose by reviewable
deliverables and reuse the project's existing architecture.

## When to Use

- A specified feature needs several dependent implementation steps.
- Work spans components and needs explicit ownership or migration order.
- A plan will be handed to child agents or resumed after interruption.

A tiny mechanical edit may need only a short task checklist, rather than a
new design document or a mandatory documentation commit.

## Prerequisites

- The request or accepted design, current code, and repository instructions.
- Exact interfaces, affected platforms, and required validation commands.
- `read_file`, `search_files`, and `write_file` for planning artifacts.
- A known execution scope, branch/worktree, and any external action limits.

## How to Run

1. Read the requirements and inspect the implementation seams.
2. Map file responsibilities and task dependencies.
3. Write concrete tasks with inputs, outputs, checks, and completion criteria.
4. Review coverage and interface consistency before execution.

Use [references/plan-template.md](references/plan-template.md) for a durable
multi-task plan; replace its guidance with real project-specific details.

## Quick Reference

| Plan element | Required information |
| --- | --- |
| Goal | Observable requested outcome |
| Constraints | Exact compatibility, data, policy, and platform requirements |
| File map | Existing/new paths and each responsibility |
| Task | Independent deliverable, consumed and produced interfaces |
| Validation | Supported command and the behavior it proves |
| Integration | Dependency order, migration, rollback, final acceptance |
| Authorization | Which publish/merge/deploy actions the user requested |

## Procedure

### Inspect before decomposing

Read the design and trace the existing path. Identify reusable components,
stores, APIs, lifecycle hooks, tests, and packaging behavior. Verify exact
symbol names and types rather than inventing plausible interfaces.

Document the files to create or modify and why each owns that behavior.
Keep feature-related units together and follow existing project patterns.
Split an unwieldy module only when it helps the requested change.

### Define deliverables and dependencies

A task should produce something independently testable and worth a focused
review. Include setup, configuration, and documentation in the task whose
deliverable needs them instead of creating empty scaffolding tasks.

Identify which tasks share files or interfaces. Serialize dependent changes
and assign disjoint file ownership for concurrent work. A task that consumes
an interface must name the exact producer and contract.

Prefer small coherent tasks over arbitrary time boxes. Several identical
mechanical edits may belong in one task, while a migration and its consumer
may need explicit intermediate compatibility.

### Write concrete implementation steps

For each task, include:

1. Exact file paths and existing symbols to inspect or modify.
2. Input and output contracts, state ownership, and error behavior.
3. A focused behavior test or proportionate direct verification.
4. The implementation approach and any critical code examples.
5. The supported commands and expected result.
6. A completion condition and implications for later tasks.

For a regression, explain how the test demonstrates the existing bug.
Avoid tests that only search source text or mirror the implementation.

Use actual project commands and fixtures, not a guessed generic runner.
Identify baseline requirements and platform-specific checks. State when
an unavailable external environment will limit acceptance.

Do not leave “TBD,” “implement later,” “add suitable validation,” or dangling
function names in an executable plan. Where a deliberate decision remains,
name it and separate independent work from the dependent task.

### Review and hand off

Compare every requirement with a task or acceptance check. Verify consistent
names, types, paths, state transitions, version constraints, and task order.
Check migrations, recovery, cancellation, and data preservation where affected.

Save the plan in the repository's preferred location, with a link to the
design and exact scope. Keep status updates separate from the stable design
unless the project uses a single living document.

Continue using `executing-plans` or `subagent-driven-development` if the
user already authorized implementation. Otherwise present the plan for
the requested review. Do not make commits or create extra worktrees merely
because the template mentions an execution phase.

## Pitfalls

- Planning around assumed source structure without reading it.
- Defining the same interface differently in neighboring tasks.
- Splitting setup from its consumer so neither deliverable works.
- Writing a complete speculative implementation before resolving a contract.
- Mandating commits, dependencies, or external actions outside user scope.
- Treating a task checkbox as evidence of integration success.

## Verification

Confirm complete requirement coverage, resolvable paths and symbols, explicit
dependencies, and meaningful acceptance checks. The executor should know
what to change, why, and how to prove it without guessing a missing decision.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/writing-plans).
The upstream MIT notice is included in `LICENSE`.
