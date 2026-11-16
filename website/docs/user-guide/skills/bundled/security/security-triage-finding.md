---
title: "Triage Finding — Validate security findings and separate false positives"
sidebar_label: "Triage Finding"
description: "Validate security findings and separate false positives"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Triage Finding

Validate security findings and separate false positives.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/security/triage-finding` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `triage-finding`, `security` |
| Related skills | [`security-scan`](../../bundled/security/security-security-scan.md), [`verification-before-completion`](../../bundled/software-development/software-development-verification-before-completion.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Triage Finding Skill

Assess a supplied security claim against the real implementation and threat boundary. Keep validation, impact assessment, and remediation recommendations distinct; this workflow does not require a private hosted scanner.

## When to Use

Use for scanner output, review comments, disputed vulnerabilities, suspected duplicates, and verification of a proposed security fix.

## Prerequisites

- The exact claim, affected revision and code path, plus the repository's security policy.
- Authorized source and a local isolated reproduction environment.
- Evidence of attacker control and intended behavior; ask only for missing facts that materially block classification.

## How to Run

Use `search_files` and `read_file` to trace the affected path, and `terminal` to run project-native tests or a minimal safe reproduction. Load `security-scan` for a broader audit only if that is requested.

## Quick Reference

| Status | Evidence required |
| --- | --- |
| Validated | Reachable effect across a defined boundary |
| Not reproducible | Reproduction attempted with documented conditions |
| False positive | Concrete check or assumption disproves the claim |
| Needs evidence | Missing facts prevent a conclusion |
| Duplicate | Same root cause and impact as an identified finding |

A severity label must follow the actual impact and prerequisites.

## Procedure

1. Rewrite the claim as input, attacker capability, boundary crossed, and expected versus actual effect.
2. Locate the precise implementation and follow all relevant checks and callers, including sibling/platform paths.
3. Compare intended isolation and compatibility requirements with history and tests; avoid treating intentional restrictions as defects.
4. Attempt the narrowest local reproduction on the affected revision and control/base condition. Record what was observed.
5. Assess affected users, required privileges, repeatability, and impact without relying only on a scanner score.
6. Recommend the smallest fix and an invariant regression test if validated. Do not modify code unless fixing is in the user's scope.
7. Return the status, evidence, confidence, remaining uncertainty, and policy-appropriate disclosure destination.

## Pitfalls

- Failure to reproduce in a different environment does not disprove the original claim.
- Do not downgrade a finding solely because a trusted UI normally hides the vulnerable API.
- A fixed example may leave sibling paths exposed; verify the boundary rather than a single string.
- Avoid copying secrets or exploit payloads into public artifacts.

## Verification

Ensure the conclusion follows the recorded experiment. If verifying a fix, show the exploit condition fails while authorized behavior still works, and state any untested platform or deployment conditions.
