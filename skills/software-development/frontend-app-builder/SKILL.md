---
name: frontend-app-builder
description: Build interactive frontends faithful to approved designs.
version: 1.0.0
author: OpenAI; Aino contributors (native adaptation)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, frontend-app-builder]
    category: software-development
    related_skills: [frontend-testing-debugging, design-taste-frontend, impeccable]
---

# Frontend App Builder Skill

Build a complete frontend from the user's brief, existing product and approved visual reference. Preserve functional truth and recognizable structure, then verify the implementation against rendered evidence rather than equating working code with visual fidelity.

## When to Use

- Create a new website, app surface, dashboard or interactive prototype.
- Implement an approved screenshot, design concept or page-by-page redesign.
- Unify existing UI without losing routes, account boundaries, permissions or workflow behavior.

## Prerequisites

- Read area instructions and inspect the actual stack, routes, theme tokens, shared controls and existing state stores using `search_files` and `read_file`.
- Use `terminal` for the project's scripts and `patch` for scoped source changes.
- Render using available `desktop_preview` / `drive_preview` or `browser_exec`; use the project's browser tests when suitable.
- Use `image_generate` only when a configured provider is available and the brief needs original raster assets. Generated art is optional for normal UI work; do not claim generation or source images that were never produced.
- A prototype uses clearly described local state. Authentication, payment or backend persistence must reuse a real authorized integration or be identified as out of scope.

## How to Run

1. Establish the product's current behavior, content and constraints before proposing visual changes.
2. Translate the brief into a screen/state inventory and a small token/component specification.
3. For a new visual direction, provide a reviewable interactive concept. If an approved design already exists, implement it directly.
4. Build in the existing stack and reuse shared components and state ownership.
5. Run the real interaction flow and compare rendered screenshots with the approved reference.

## Quick Reference

| Surface | Preserve first |
|---|---|
| Desktop workspace | Navigation, pane ownership, resize behavior, keyboard flow |
| Dashboard | Row density, hierarchy, filters, table/detail relationships |
| Form | Field order, labels, validation, submit/recovery states |
| Marketing page | Brand, real claims, section order, key imagery and action |
| Editor | Canvas scale, document text, toolbar and selection semantics |
| Clone-like reference | Recognizable layout and component anatomy before polish |

## Procedure

### Collect real product context
Inspect current routes and render the relevant pages. List each visible control, what state it changes, where it navigates and which data it owns. Include settings, notifications, menus, loading/error/empty states, Bot/group views and panels when they are part of the request. Do not redesign from a screenshot alone when source and runtime are available.

Extract font families, type scale, line height, colors, spacing, radii, borders, icon weight and surface hierarchy. Treat the user's approved colors and layout as constraints. Resolve conflicting references explicitly by applying the latest approved target and recording functional exceptions.

### Define a reviewable target
Write exact visible copy and a component/state table. For reference work, inventory key landmarks: rail width, header height, content measure, panel boundaries, button hit areas, icon sizes and first viewport. Avoid adding invented badges, claims, counts or actions.

A prototype must make meaningful controls work: navigation selects the correct page, filters change data, panes open/close, forms validate, errors recover, and choices persist where appropriate. Keep mock data local and representative; do not impersonate a live server transaction. Use `::preview{file="/absolute/path/prototype.html"}` for a saved local HTML artifact when desktop inline preview is supported.

### Implement faithfully
Reuse the project's package manager and frameworks. Prefer existing components, icon family and tokens. Extract repeated anatomy rather than styling each screen independently. Keep route roots thin and state in feature-owned stores or hooks. Avoid global effects, unstable keys, duplicate sources of truth and styling that changes unrelated surfaces.

Assets must load and match the approved design's crop, color and role. Preserve accurate logos and licensed attribution. Prefer a real icon set or clean SVG for UI glyphs; use generated images for raster artwork when needed. Do not hide missing assets behind generic gradients or substitute a different product's imagery.

Use semantic controls, visible labels, keyboard focus and real disabled/loading behavior. Keep content readable with long names, narrow windows and translated strings. Use motion for continuity and feedback; honor reduced motion and never hide content behind an animation prerequisite.

### Compare and refine
Run applicable type/lint/build checks. Render at the reference dimensions and a narrow viewport. Inspect the reference and latest screenshot together, checking at least layout, copy, typography, icons, palette, spacing and state behavior. Record differences in [references/fidelity-ledger.md](references/fidelity-ledger.md), fix material drift and rerun the affected flow.

For multi-page work, check each page and relevant open-panel/modal/error state. The main conversation screenshot does not validate settings or group chat. Functional QA and visual QA are separate evidence requirements.

## Pitfalls

- Designing an unrelated attractive page while the request concerns an existing product.
- Turning tables into cards, adding a marketing hero to an operating tool, or changing the approved palette.
- Inert prototype controls, fake progress, fabricated account values or a success state before a real result.
- Broad CSS overrides, duplicated controls and browser-default typography hidden in secondary surfaces.
- Assuming image generation, inline preview or a design service is available merely because this skill is loaded.

## Verification

Verify all requested routes/states are present, core interactions change the correct state, assets render, content does not clip, and keyboard/reduced-motion behavior is usable. Report the accepted reference, implementation path, browser surface, viewport and at least five concrete comparison points. State any unverified integration or intentional difference precisely.
