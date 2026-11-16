---
name: product-design-audit
description: Audit usability, interaction and interface consistency.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, product-design-audit]
    category: creative
    related_skills: [product-design, impeccable, frontend-testing-debugging]
---

# Product Design Audit Skill

Review an existing product through real tasks and produce actionable, evidence-backed findings. Distinguish broken functionality and comprehension barriers from preferences, then rank repairs by their consequence for the user.

## When to Use

- Users report a confusing, awkward, inconsistent or untrustworthy experience.
- A multi-page design needs a systematic consistency pass.
- A new interaction should be reviewed before implementation or release.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Define the task and the pages/states in scope.
2. Walk the flow in the real UI, including failure and recovery.
3. Record findings with reproduction, evidence, consequence and repair.
4. Group shared root causes and verify any authorized fixes.

## Quick Reference

| Dimension | Questions |
|---|---|
| Orientation | Does the page say where the user is and what can happen? |
| Hierarchy | Is the result/action more prominent than process noise? |
| Feedback | Are progress, waiting, cancellation and completion distinct? |
| Recovery | Can users undo, retry or resume without losing context? |
| Consistency | Do equivalent controls look and behave alike? |
| Access | Keyboard, contrast, zoom, focus, long text, narrow layout? |
| Trust | Are identity, costs, permissions and stored state accurate? |

## Procedure

### Establish scope and evidence
List tasks, routes, user role, window sizes and the approved design if any. Use real or representative authorized data. Inspect source where necessary to understand whether an issue comes from layout, state management or a service failure.

### Perform a task walkthrough
Start at the natural entry. Observe what a new user can infer without coaching. Exercise primary actions, back navigation, context switching, open panels, notifications and settings that are relevant to the task. Include loading, empty/error, retry and cancellation. Avoid destructive live actions when a local fixture demonstrates the same interaction.

### Evaluate reading and operation rhythm
Check stable body/summary positions, progress-to-result hierarchy, control feedback, text measure, repeated labels and process disclosure. Look for duplicated avatars, stale errors after changing a model, flashing amounts or containers shifting when a toast appears. These are candidate symptoms, not assumed defects: reproduce before reporting.

### Inspect consistency across surfaces
Compare component families, header heights, icon weight, focus states, divider ownership, pane alignment and overlays. Verify account/profile boundaries and truthful device/user labels where present. A shared token/component fix is often better than independent per-page patches.

### Write findings people can act on
Use [templates/audit-finding.md](templates/audit-finding.md). Include exact entry/action, expected/observed result, evidence, user consequence and the smallest plausible repair. Rank blocked or unsafe outcomes first, repeated friction next and minor visual drift last. Do not assign numerical scores without a defined scale and evidence.

### Close the loop
When fixes are authorized, reproduce before editing, repair the cause and rerun the flow plus a sibling path. Track resolved and remaining findings separately. Otherwise provide a concrete prioritized repair set with enough evidence to review.

## Pitfalls

- Reporting every style preference as a bug.
- A static screenshot audit that claims successful interaction testing.
- Generic advice without a location, reproduction or user consequence.
- Fixing a symptom by removing a needed capability or clearing all user data.

## Verification

Every material finding has evidence and an observable acceptance condition. Authorized repairs are retested in the original flow. State inspected pages/states, untested platforms and whether the audit included live integrations or representative fixtures.
