---
title: "Signing Entitlements — Inspect macOS signatures, entitlements, and trust"
sidebar_label: "Signing Entitlements"
description: "Inspect macOS signatures, entitlements, and trust"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Signing Entitlements

Inspect macOS signatures, entitlements, and trust.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/apple/signing-entitlements` |
| Version | `1.0.0` |
| Author | OpenAI, Aino contributors |
| License | MIT |
| Platforms | macos |
| Tags | `signing-entitlements`, `apple` |
| Related skills | [`packaging-notarization`](../../bundled/apple/apple-packaging-notarization.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# macOS Signing Entitlements Skill

Inspect macOS signing and trust problems from the actual bundle. Separate signature integrity, hardened runtime, entitlements, provisioning, and Gatekeeper policy before recommending changes.

## When to Use

Use for launch refusal, invalid signatures, sandbox mismatch, missing capability permissions, or distribution trust issues.

## Prerequisites

- macOS, Xcode or Command Line Tools appropriate to the project.
- `terminal`, `search_files`, `read_file`, and `patch` for local inspection/build changes.
- Preserve existing build scripts, signing profiles, and repository instructions. A local build does not authorize publishing or credential changes.

## How to Run

Use `terminal` for the commands below after resolving actual project and artifact paths. Use `read_file` for build logs and settings; use `patch` for the smallest source/configuration change.

## Quick Reference

```text
codesign -dvvv --entitlements :- <app-or-binary>
codesign --verify --deep --strict --verbose=2 <app>
spctl -a -vv <app>
security find-identity -p codesigning -v
plutil -p <entitlements-or-Info.plist>
```

Inspection is read-only. Re-signing changes the artifact and must fit the user's task.

## Procedure

1. Identify the exact `.app` and executable in `Contents/MacOS`, bundle ID, distribution channel, and observed failure.
2. Inspect signature details and entitlements on the main executable and relevant nested helpers/frameworks.
3. Compare actual entitlements with project signing settings, required capabilities, and any provisioning profile.
4. Classify the failure: unsigned/ad-hoc, identity mismatch, entitlement mismatch, nested signature, hardened runtime, sandbox, or distribution/notarization.
5. Recommend or apply the minimum authorized build-setting/signing correction. Do not add broad entitlements or disable security controls without evidence.
6. Rebuild using the project's signing workflow so nested code is signed consistently; avoid masking an invalid bundle with blind recursive force-signing.
7. Repeat integrity/trust checks and the originally failing behavior.

## Pitfalls

- Gatekeeper rejection and a compile error are different failure classes.
- Valid local ad-hoc signing does not imply distribution trust.
- Never print certificate private keys, passwords, or notarization credentials.
- Do not invent entitlement names or relax sandbox boundaries as a generic fix.

## Verification

Report the inspected artifact, identity/team, relevant entitlements, exact failure class, and before/after validation. Distinguish local launch success from distribution readiness.

## Attribution

Adapted from the OpenAI build-macos-apps MIT-licensed skill; Aino uses its native terminal and desktop tools.
