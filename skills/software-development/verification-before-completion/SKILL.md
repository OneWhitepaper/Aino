---
name: verification-before-completion
description: Match completion claims to current execution evidence.
version: 1.0.0
author: Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [verification, evidence, testing, completion]
    category: software-development
    related_skills: [test-driven-development, requesting-code-review]
---

# Verification Before Completion Skill

Make completion claims only when current evidence supports them. Select
checks that prove the requested outcome and report material limits plainly.

## When to Use

- Before reporting that a fix works, tests pass, or a task is complete.
- Before a requested commit, merge, deployment, or release.
- When reviewing another agent's result or a previous verification report.

## Prerequisites

- The user's acceptance conditions and relevant repository instructions.
- The actual code, artifact, environment, and supported runner.
- `terminal` for executable checks and native tools to inspect results.
- A known version or diff tying the evidence to what will ship.

## How to Run

Identify the claim, choose a check that can disprove it, run that check,
read the relevant output, and compare the evidence with the claim.
Scale checks to the impact and follow project-required validation.

## Quick Reference

| Claim | Supporting evidence |
| --- | --- |
| Bug fixed | Original scenario now produces the expected result |
| Tests pass | Relevant run finished with the expected exit status |
| Builds | Required target produced a valid artifact |
| UI works | Observed interaction in the supported renderer or device |
| Deployment succeeded | Deployed revision and relevant live behavior checked |
| Merge complete | Exact branch or PR state confirmed after integration |
| Data preserved | Expected records readable after the transition |

## Procedure

### 1. Define the claim precisely

Translate “done” into observable acceptance conditions. Include the platform,
account, data, and workflow boundaries that matter. Separate implementation,
unit tests, integration behavior, packaging, and deployment.

Identify mandatory conditions and those unavailable in the current
environment. Do not claim cross-platform behavior from one host or treat
a local build as proof of online deployment.

### 2. Choose decisive checks

Read the project's documented commands before improvising. Prefer focused
regression checks first, followed by required integration or CI checks.
For visual or performance changes, include observation or measurement.

A successful command can be inconclusive: tests may be skipped, a script
may hide a failed subprocess, or an artifact may be from an old build.
Know which output and exit status establish success.

### 3. Execute and read the result

Run against the current source or artifact. Inspect warnings, skips,
failures, and final status. Confirm the intended paths actually ran using
identifiers rather than relying on a reassuring summary.

Keep enough output to assess meaningful results. Do not filter away
errors or discard the exit code through a pipeline.

If a check fails, investigate and fix within scope, then rerun affected
checks. Reproduce suspected baseline failures in an isolated known
revision rather than modifying the user's staged work.

### 4. Validate delegated and integrated work

An agent's completion message is a lead, not independent evidence.
Inspect the resulting diff, exact version tested, and relevant commands
or artifacts. Verify integrated behavior where changes can interact,
even if each focused test passed.

A review approval does not substitute for execution. A green unit suite
does not prove a deployment, native window, or migration works.

### 5. Report the supported outcome

State what changed, why it satisfies the request, and what evidence passed.
Name remaining failures or unavailable checks with their practical impact.

Once checks pass, repeat them only after new changes, failures, or an
unresolved concern justifies it. Verification should resolve uncertainty,
not become an endless ritual.

## Pitfalls

- Saying “should work” or “all green” before running checks.
- Reusing evidence from before the last meaningful source change.
- Equating lint success with runtime correctness.
- Treating skipped tests or a partial run as a complete suite.
- Trusting a cached artifact or child-agent summary without inspection.
- Marking complete while a mandatory acceptance step remains.

## Verification

The report must identify the concrete outcome and its evidence.
Distinguish confirmed behavior from untested environments or blocked
external steps. Do not broaden a narrow success into a larger claim.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion).
The upstream MIT notice is included in `LICENSE`.
