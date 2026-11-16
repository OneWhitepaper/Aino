---
title: "Product Design — Plan coherent product interfaces from real user tasks"
sidebar_label: "Product Design"
description: "Plan coherent product interfaces from real user tasks"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Product Design

Plan coherent product interfaces from real user tasks.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/product-design` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `product-design` |
| Related skills | [`product-design-get-context`](../../bundled/creative/creative-product-design-get-context.md), [`product-design-audit`](../../bundled/creative/creative-product-design-audit.md), [`frontend-app-builder`](../../bundled/software-development/software-development-frontend-app-builder.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Product Design Skill

Coordinate product design from an observed task through context, alternatives, implementation and validation. Select the smallest relevant workflow rather than treating every UI request as a new visual identity.

## When to Use

- Design or redesign a feature, app page, multi-screen flow or reusable component family.
- A user invokes product design without specifying the method.
- A project needs its existing behavior and approved design reconciled.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Identify the task, surface, evidence and deliverable.
2. Route to the relevant skill in the table; combine only the necessary stages.
3. Preserve a shared brief and acceptance checks across discovery, prototype and implementation.
4. Deliver the concrete artifact or repair and the evidence used to evaluate it.

## Quick Reference

| Need | Workflow |
|---|---|
| Understand users and jobs | `product-design-user-context` |
| Inspect repo/product/reference | `product-design-get-context` |
| Research a pattern or benchmark | `product-design-research` |
| Diagnose an existing flow | `product-design-audit` |
| Explore alternatives | `product-design-ideate` |
| Implement a screenshot | `product-design-image-to-code` |
| Recreate a public page | `product-design-url-to-code` |
| Compare implementation with design | `product-design-design-qa` |
| Build a complete frontend | `frontend-app-builder` |

## Procedure

### Define the design contract
Write one sentence naming the user, situation, intended action and observable success. Identify whether the user wants analysis, an interactive preview, implementation or a combination. Inspect what already exists before asking for facts obtainable from source.

List real capabilities and constraints: routes, account/profile ownership, permissions, persistence, models/providers, keyboard behaviors, pane relationships and supported platforms. Existing functionality is a design constraint, not disposable prototype material.

### Gather enough context
Use the repository and current UI to separate product facts from stylistic assumptions. Review existing tokens and controls. When user evidence is needed, ask only the material missing question and continue independent inspection. Do not fabricate interviews, analytics or customer quotations.

### Choose a path
For a narrow defect, reproduce and repair it. For a new flow, map states and propose a coherent option. For an approved design, proceed to implementation and comparison. Use research only when it can change a decision; do not turn a simple spacing fix into a broad strategy exercise.

Capture the brief in [templates/design-brief.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/product-design/templates/design-brief.md) when a durable artifact will help. Keep private account information out of shared product documents.

### Make the concept reviewable
Use the actual product anatomy, labels, representative data and functional states. Each control must have a logical destination or state transition. Demonstrate loading, error, cancel and recovery where relevant. Mark local mock behavior in delivery notes, and reuse real integrations when already authorized.

### Carry intent into implementation
Use the project's shared components, semantic tokens and state architecture. Keep a route/state inventory so settings, menus, Bot/group views and opened panels are not forgotten. Do not add a parallel navigation manager or persistence model for visual work.

### Evaluate completion
Check both task success and fidelity. Verify keyboard and narrow-window operation, long content and relevant data boundaries. Report what changed and what users can now do, with artifact paths and observed evidence. Explicitly identify missing tools or inaccessible platforms.

## Pitfalls

- Designing from a reference image while ignoring the current application.
- Adding attractive controls without defining their behavior.
- Repeatedly requesting approval for routine reversible work already authorized.
- Claiming a prototype demonstrates live backend reliability.

## Verification

Every requirement has a corresponding screen/state and acceptance check. Verify the main interaction, relevant failure/recovery path and design consistency; use `product-design-design-qa` for reference comparisons. Include remaining limitations without calling unavailable integrations complete.
