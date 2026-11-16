---
title: "Systematic Debugging — Trace failures to their cause and verify the repair"
sidebar_label: "Systematic Debugging"
description: "Trace failures to their cause and verify the repair"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Systematic Debugging

Trace failures to their cause and verify the repair.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/systematic-debugging` |
| Version | `1.2.0` |
| Author | Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `debugging`, `root-cause`, `troubleshooting`, `regression` |
| Related skills | [`test-driven-development`](../../bundled/software-development/software-development-test-driven-development.md), [`verification-before-completion`](../../bundled/software-development/software-development-verification-before-completion.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Systematic Debugging Skill

Investigate the failure before changing the system. Build a short feedback
loop that distinguishes the reported bug from unrelated failures, then fix
the earliest incorrect behavior you can demonstrate.

## When to Use

- A reproducible bug, failing test, build failure, or broken integration.
- Performance, rendering, state, or timing behavior with an unclear cause.
- A previous fix failed or a plausible workaround hides the symptom.

## Prerequisites

- Expected behavior, affected environment, and relevant logs.
- Repository and area instructions, including the supported test runner.
- Native `read_file`, `search_files`, `terminal`, and `patch` tools.
- An isolated test account, profile, or data directory for stateful checks.

## How to Run

1. Record the exact symptom and one command or interaction that exposes it.
2. Find the first boundary where expected state becomes incorrect.
3. Test a falsifiable hypothesis with one controlled change.
4. Repair the cause and verify the original scenario plus related behavior.

For distributed state or a misleading stack trace, read
[references/root-cause-tracing.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/systematic-debugging/references/root-cause-tracing.md).

## Quick Reference

| Phase | Evidence needed before moving on |
| --- | --- |
| Reproduce | Exact input, environment, expected and observed result |
| Compare | A working path and the differences that could matter |
| Hypothesize | A proposed cause and a result that would disprove it |
| Repair | Minimal fix, regression evidence, and relevant checks |

## Procedure

### 1. Establish a tight reproduction

Read the complete error, including the first causal failure and its callers.
Confirm the code, branch, version, configuration, account, and platform
that actually ran. A similar error on another path is not the same repro.

Create the fastest deterministic check that can fail on this symptom.
Prefer an existing public entry point with temporary test state over a
mocked version of the implementation. If deterministic automation is not
possible, write precise interaction steps and capture observable evidence.

Reduce the input while preserving the failure. Record whether it occurs
always, after a specific transition, or only under load. For intermittent
failures, capture event order and state instead of adding arbitrary sleeps.

Inspect recent changes and the history of the responsible symbol. Verify
both the claimed defect and the intended behavior; isolation, caching, or
a missing fallback may be deliberate.

### 2. Locate the responsible boundary

Use `search_files` to find the failing call and `read_file` for its
implementation and a working sibling. Read required upstream documentation
when an external contract is involved; do not assume its behavior.

At each boundary, compare what entered, what left, and who owned the state.
Add narrow temporary instrumentation only where it distinguishes causes.
Capture identifiers, timing, and data shape while redacting secrets.

List the meaningful differences between working and failing paths. Check
configuration, lifecycle, ownership, persistence, concurrency, and return
values before blaming a dependency.

### 3. Test one hypothesis

State the hypothesis explicitly: “State X becomes stale after Y because Z;
observing W before Y would disprove this.”

Rank likely causes by evidence. Make one minimal experimental change or add
one probe, run the reproduction, and read the result. Do not combine several
speculative fixes or interpret “no crash” as proof of correct behavior.

A failed experiment is new evidence. Remove irrelevant experiments and
update the theory. Repeated failures should trigger a review of the model
and component boundaries, rather than a larger pile of workarounds.

If unavailable infrastructure prevents the next decisive check, preserve
the repro, complete independent investigation, and identify the missing input.

### 4. Repair and verify

Add a behavior regression at the layer where the contract broke, using
`test-driven-development` when appropriate. Show that it fails for the
reported reason before applying the production fix.

Change the smallest shared implementation that addresses the whole class,
including sibling paths with the same ownership or lifecycle mistake.
Avoid suppressing exceptions or disabling the feature to make a test pass.

Rerun the exact reproduction, its focused tests, and checks required by
the repository. Inspect the diff and remove temporary instrumentation that
has no ongoing diagnostic value.

## Pitfalls

- Editing before confirming which executable or source tree produced the bug.
- Treating a caught downstream exception as the original cause.
- Changing several variables at once or keeping failed experiments.
- Copying a working example without understanding its required context.
- Passing because a test skipped the broken path or used the wrong patch seam.
- Turning one observed failure into an unrelated architectural rewrite.
- Using real user data or credentials in a reproduction.

## Verification

Report the cause with a concrete code path and the scenario it explains.
List actual check outcomes, separating baseline failures or unavailable
environments from confirmed fixes. Performance and UI repairs also need
measured or observed evidence of the reported effect.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging).
The upstream MIT notice is included in `LICENSE`.
