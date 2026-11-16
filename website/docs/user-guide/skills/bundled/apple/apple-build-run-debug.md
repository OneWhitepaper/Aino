---
title: "Build Run Debug — Build and diagnose macOS apps with existing workflows"
sidebar_label: "Build Run Debug"
description: "Build and diagnose macOS apps with existing workflows"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Build Run Debug

Build and diagnose macOS apps with existing workflows.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/apple/build-run-debug` |
| Version | `1.0.0` |
| Author | OpenAI, Aino contributors |
| License | MIT |
| Platforms | macos |
| Tags | `build-run-debug`, `apple` |
| Related skills | [`signing-entitlements`](../../bundled/apple/apple-signing-entitlements.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# macOS Build Run Debug Skill

Build, launch, and diagnose macOS applications using their real project toolchain. Prefer the repository's established run script; GUI applications should launch as app bundles so identity and lifecycle remain correct.

## When to Use

Use for Xcode or SwiftPM macOS build failures, startup problems, runtime diagnostics, and local app launch.

## Prerequisites

- macOS, Xcode or Command Line Tools appropriate to the project.
- `terminal`, `search_files`, `read_file`, and `patch` for local inspection/build changes.
- Preserve existing build scripts, signing profiles, and repository instructions. A local build does not authorize publishing or credential changes.

## How to Run

Use `terminal` for the commands below after resolving actual project and artifact paths. Use `read_file` for build logs and settings; use `patch` for the smallest source/configuration change.

## Quick Reference

| Project | Inspection / build |
| --- | --- |
| Xcode workspace | `xcodebuild -list -workspace <path>` |
| Xcode project | `xcodebuild -list -project <path>` |
| Build | `xcodebuild -workspace <path> -scheme <scheme> -configuration Debug build` |
| Swift package | `swift package describe`, `swift build`, `swift test` |
| GUI bundle launch | `open <exact-built-app-path>` |

Use a known scheme and destination from discovery; do not assume names.

## Procedure

1. Read project instructions and discover `.xcworkspace`, `.xcodeproj`, `Package.swift`, or a documented build/run entrypoint using `search_files`.
2. Run existing scripts first when they are current. For Xcode, inspect schemes/build settings and select a macOS destination; for SwiftPM distinguish a CLI from an AppKit/SwiftUI GUI product.
3. Capture build output and identify the first causal error instead of treating downstream failures as separate bugs.
4. Apply the narrow fix and rebuild the affected target. Keep build artifacts and temporary logs in project/temporary output paths.
5. Launch the exact built `.app`; verify its bundle ID, running process, and visible window with authorized `computer_use` if available.
6. For a restart, stop only the verified process belonging to this app/build. Never kill every Electron, Swift, or app-name substring match.
7. Run relevant tests and summarize build versus launch versus UI verification separately.

## Pitfalls

- Raw SwiftPM GUI executable launch can omit bundle identity, Dock presence, or activation behavior.
- Notarization is not required for ordinary local debug runs.
- Do not overwrite Codex host configuration to create a run button inside Aino.
- A successful process spawn does not prove a usable app window.

## Verification

Confirm build exit status, exact artifact path, bundle identity, launch result, and any inspected UI state. State the smallest remaining blocker when the workflow cannot complete.

## Attribution

Adapted from the OpenAI build-macos-apps MIT-licensed skill; Aino uses its native terminal and desktop tools.
