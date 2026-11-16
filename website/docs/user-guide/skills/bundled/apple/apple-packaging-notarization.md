---
title: "Packaging Notarization — Validate macOS distribution bundles and notarization"
sidebar_label: "Packaging Notarization"
description: "Validate macOS distribution bundles and notarization"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Packaging Notarization

Validate macOS distribution bundles and notarization.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/apple/packaging-notarization` |
| Version | `1.0.0` |
| Author | OpenAI, Aino contributors |
| License | MIT |
| Platforms | macos |
| Tags | `packaging-notarization`, `apple` |
| Related skills | [`signing-entitlements`](../../bundled/apple/apple-signing-entitlements.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# macOS Packaging Notarization Skill

Prepare and validate macOS distributable artifacts using the project's packaging workflow. Assess the actual exported bundle and notarization result, keeping local debug needs separate from public distribution.

## When to Use

Use for archive/export, DMG/ZIP/PKG preparation, nested signing, notarization, stapling, and distribution-only failures.

## Prerequisites

- macOS, Xcode or Command Line Tools appropriate to the project.
- `terminal`, `search_files`, `read_file`, and `patch` for local inspection/build changes.
- Preserve existing build scripts, signing profiles, and repository instructions. A local build does not authorize publishing or credential changes.

## How to Run

Use `terminal` for the commands below after resolving actual project and artifact paths. Use `read_file` for build logs and settings; use `patch` for the smallest source/configuration change.

## Quick Reference

| Check | Command |
| --- | --- |
| Signature integrity | `codesign --verify --deep --strict --verbose=2 <app>` |
| Trust assessment | `spctl -a -vv <app>` |
| Notarization result | `xcrun notarytool info <id> --keychain-profile <profile>` |
| Failure detail | `xcrun notarytool log <id> --keychain-profile <profile>` |
| Ticket validation | `xcrun stapler validate <artifact>` |

Only an authorized release task may submit artifacts or publish a release.

## Procedure

1. Confirm requested artifact/platform/architecture/version and whether the task is readiness review or an authorized release.
2. Run the existing packaging script. Validate bundle structure, Info.plist identifiers/version, resources, architectures, and nested executables.
3. Load `signing-entitlements` to inspect distribution identity, hardened runtime, and required entitlements; check nested signatures before archive upload.
4. Build the distribution container without silently changing the application identity or user-data location.
5. If notarization submission is authorized and an existing keychain profile is available, follow the repository workflow. Never collect credentials in chat or place them in command arguments.
6. Read the actual notarization status/log. Staple only supported artifacts after acceptance, then validate the ticket and exported container.
7. Test install/launch and upgrade/data-preservation in an isolated environment appropriate to the release. Publish only if explicitly requested.

## Pitfalls

- An accepted notarization is not evidence of functional correctness or safe migration.
- Do not treat missing distribution credentials as a reason to block local build/debug work.
- Do not sign with a different app identity to make a check pass.
- Preserve upstream license notices and bundled dependency attribution.

## Verification

Record artifact hash/path, version/architecture, signature and ticket validation, notarization evidence, and functional checks. Clearly label inferred readiness when the final exported artifact is unavailable.

## Attribution

Adapted from the OpenAI build-macos-apps MIT-licensed skill; Aino uses its native terminal and desktop tools.
