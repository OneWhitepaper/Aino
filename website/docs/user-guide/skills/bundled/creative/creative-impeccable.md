---
title: "Impeccable — Refine interface craft, hierarchy, states and motion"
sidebar_label: "Impeccable"
description: "Refine interface craft, hierarchy, states and motion"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Impeccable

Refine interface craft, hierarchy, states and motion.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/impeccable` |
| Version | `4.2.0-aino.1` |
| Author | Paul Bakaus (pbakaus); Aino contributors (native adaptation) |
| License | Apache-2.0 |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `impeccable` |
| Related skills | [`design-taste-frontend`](../../bundled/creative/creative-design-taste-frontend.md), [`product-design`](../../bundled/creative/creative-product-design.md), [`frontend-testing-debugging`](../../bundled/software-development/software-development-frontend-testing-debugging.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Impeccable Skill

Bring deliberate visual craft to real interfaces while preserving their product behavior. This Aino-native adaptation bundles the design practice locally; it does not require the upstream detector binary, download an engine or install editor hooks.

## When to Use

- Design, critique, audit, polish, simplify, harden or adapt a web or app interface.
- Improve typography, layout, color, motion, onboarding, errors or component consistency.
- Capture an existing design system into reusable tokens and documentation.

## Prerequisites

- Inspect actual product screens and implementation with `read_file`, `search_files` and the available preview/browser tools before styling.
- Use `patch` and `terminal` in the project's native stack. Use `drive_preview` / `browser_exec` for rendered evidence when available.
- Read PRODUCT.md, DESIGN.md and relevant area instructions if present. Missing design documents do not make an established product a blank canvas.
- No launcher, design MCP, editor hook or detector is installed by this skill. Perform the documented review directly. Use `image_generate` only with an available configured provider when the brief needs raster art.

## How to Run

1. Identify the requested operation and the visitor's task mode below.
2. Inspect current visual truth and agree with the existing brief on what to preserve or replace.
3. Read [references/craft-floor.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/impeccable/references/craft-floor.md) before editing and the matching recipe in [references/operations.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/impeccable/references/operations.md).
4. Make a coherent, scoped change using shared components and tokens.
5. Inspect rendered shipped states, repair material issues and provide evidence.

## Quick Reference

| Mode | Success | Design emphasis |
|---|---|---|
| Persuade | Visitor understands an offer and acts | Brand, composition, real imagery, clear action |
| Operate | User completes a task | Familiar controls, hierarchy, density, continuity |
| Read | Reader understands material | Structure, prose measure, navigation, type |
| Experience | Visitor encounters the work | Artifact prominence, restrained surrounding chrome |

Choose per surface: a product's landing page persuades; its settings page operates. For app work, read [references/operate.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/impeccable/references/operate.md).

## Procedure

### Respect the visual authority
The user's pinned palette, layout and materials win over personal taste. Refinement preserves identity, behavior, content and scope. A requested redesign may replace the visual language while retaining factual truth, routes, functionality, native affordances and account boundaries. Do not silently turn refinement into replacement.

Inspect the running app, approved references and source tokens together. When it cannot run, inspect current screenshot fixtures against current code and explain the evidence limit. A filename alone does not establish a reference's authority or freshness.

### Route the work
- **init / document:** record product purpose and constraints in PRODUCT.md, or extract the implemented design system into DESIGN.md.
- **shape:** map the task, screen sequence, data states and primary actions before coding.
- **critique / audit:** identify evidence-backed UX or technical defects; separate taste preferences from failures.
- **polish:** align density, spacing, typography, optical sizes and secondary surfaces.
- **bolder / quieter:** adjust contrast and expression while keeping the approved product identity.
- **distill / clarify:** reduce competing layers and improve labels, error recovery and action wording.
- **harden / onboard:** cover loading, empty, error, first run, permission, long text and cancellation.
- **animate:** establish continuity and control feedback without blocking input or moving final content unpredictably.
- **colorize / typeset / layout:** use a consistent semantic color/type/spacing system.
- **adapt:** restructure for shipped window/device sizes and accessibility scaling.
- **optimize:** measure the slow path, repair the cause, preserve state and verify the original interaction.
- **extract:** move repeated primitives into shared components/tokens without a parallel style system.
- **delight / overdrive:** choose a purposeful expressive moment only when the surface's task and brief support it.
- **live / generate:** provide local interactive alternatives using Aino preview, keeping the original option and enough context to compare. Do not claim upstream live-edit engine capabilities.

### Build a coherent system
Name component families and use one anatomy for equivalent controls. Align section edges and dividers across panes. Match icon optical weight, hit area, radii and focus treatment. Give visible state changes immediate feedback and stable space; avoid flashing placeholders and unrelated remounts during navigation.

Use content and type hierarchy before adding containers. Product UIs generally need restraint, clear density and familiar controls; marketing and showcase work may support stronger expression. Repeated cards, badges or animation are choices to justify, not automatic scaffolding.

### Verify rendered quality
Inspect desktop and the relevant narrow/native sizes together. Check long text, menu clipping, keyboard focus, zoom, reduced motion, loading/error/empty states and real interactions. Batch corrections from a render rather than repeatedly tweaking a single pixel in isolation. Do not stop while a reproducible material defect remains; report inaccessible environments honestly.

## Pitfalls

- Replacing the user's palette or layout merely because a generic design rule prefers another.
- Decorative motion in a task tool, modal-first flows, nested containers and inconsistent component vocabulary.
- Adding a new hidden recorder, model service, detector or hook under the guise of design work.
- Assuming a static screenshot proves cancellation, focus, responsiveness or successful data mutation.
- Calling an upstream engine or shortcut that is not bundled or configured in Aino.

## Verification

Verify requested operations against the real surface and user task. Include changed screens, the rendered interaction checked, screenshot or state evidence, responsiveness/accessibility checks and any remaining limitation. This native adaptation performs manual and available-tool QA; report an automated detector result only when that detector actually ran.
