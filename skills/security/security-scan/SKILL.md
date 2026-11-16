---
name: security-scan
description: Review reachable security risks with reproducible evidence.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [security-scan, security]
    category: security
    related_skills: [triage-finding, systematic-debugging]
---

# Security Scan Skill

Perform a scoped source and configuration security review with concrete evidence. This is an independent Aino workflow and does not bundle a proprietary Codex security service or claim a penetration-test certification.

## When to Use

Use for authorized repository audits, security review of a patch, or checking a specific trust boundary. Begin with the repository's `SECURITY.md` and disclosure rules.

## Prerequisites

- Explicit target scope, available source/configuration, and a known base revision when reviewing changes.
- `read_file`, `search_files`, `terminal`; optional project-native static analysis tools.
- Use isolated test data. Live exploitation, destructive scans, and third-party system access require their own authorization.

## How to Run

Inspect the relevant entry points and follow untrusted input through validation, authorization, state changes, and output. Use existing tests or a minimal isolated reproduction to validate a candidate finding.

## Quick Reference

| Boundary | Questions |
| --- | --- |
| Authentication / tenancy | Can one principal access another's data? |
| Filesystem / process | Can input escape the permitted path or command? |
| Network / secrets | Is access scoped and credential output redacted? |
| IPC / plugins | Is sender, capability, and argument shape checked? |
| Browser / approvals | Is approval bound to the actual target and action? |

Record file/line, attacker control, preconditions, actual impact, and reproduction.

## Procedure

1. Read scope/disclosure policy and repository instructions. Identify the system's real assets and principal boundaries.
2. Inventory entry points and relevant dependencies; prioritize reachable paths rather than generic pattern counts.
3. Trace each candidate from input source to effect, including intermediate checks and profile/tenant binding.
4. Examine call sites and existing tests to disprove the claim; inspect history for intentional isolation before calling behavior a bug.
5. Reproduce with synthetic data in a temporary environment. Keep secrets and affected user data out of artifacts.
6. Rank validated findings by impact, exploitability, and preconditions. Use `triage-finding` for disputed or incomplete candidates.
7. Report validated defects and their evidence, separately listing unverified leads or unavailable coverage. Follow private disclosure policy for sensitive findings.

## Pitfalls

- A suspicious function or dependency version alone is not a demonstrated exploit path.
- Do not publish private vulnerabilities to public issues/PRs when policy requires private reporting.
- Do not recommend disabling a whole feature when a narrow boundary fix preserves it.
- Do not equate a clean scan with proof that no vulnerability exists.

## Verification

Every reported finding must identify a reachable path, crossed boundary, evidence and preconditions. Confirm repro artifacts use isolated data and no tests touched production or the user's profile.
