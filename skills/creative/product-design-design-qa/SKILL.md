---
name: product-design-design-qa
description: Compare rendered interfaces with approved designs.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, product-design-design-qa]
    category: creative
    related_skills: [frontend-testing-debugging, frontend-app-builder, impeccable]
---

# Product Design Quality Assurance Skill

Check whether the shipped page and its interactions match the approved design at meaningful states and dimensions. Use a concrete mismatch ledger so visual drift is repaired without masking functional or platform constraints.

## When to Use

- A design was approved and needs implementation-fidelity verification.
- Several pages use inconsistent typography, icons, spacing or panels.
- A release needs a visible end-to-end check of the requested UI changes.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Identify the exact approved artifact/version and implementation build.
2. Capture matched screen states and viewport dimensions.
3. Compare structural, visual, content and interaction landmarks.
4. Repair material mismatches and retest the affected flow.

## Quick Reference

| Layer | Compare |
|---|---|
| Structure | Navigation, page/pane roles, order, content measure |
| Geometry | Edges, header heights, dividers, gaps, control bounds |
| Typography | Family, size, weight, line-height, wrapping, numerals |
| Components | Icons, radii, borders, selected/focus/loading states |
| Content | Labels, facts, order, counts and representative density |
| Behavior | Destinations, panel interplay, progress, cancel/recovery |
| Adaptation | Narrow window, zoom, keyboard, reduced motion |

## Procedure

### Establish reference authority
Use the latest explicitly approved design and actual product requirements. Record a path or URL, version, dimensions and relevant states. If only a screenshot exists, separate visible evidence from interaction assumptions. Do not claim precise fidelity to an inaccessible or missing artifact.

### Capture comparable states
Open the intended build and confirm page identity. Match viewport size, theme, data density, selected item, panel state and scroll position where practical. Capture default and relevant nondefault states: opened right panel, summary, menu, notification, loading/error/empty, Bot/group page or settings.

### Inspect with measurements
Use screenshots and computed layout data when available. Compare at least five concrete landmarks, including structural alignment, typography, icons, palette and spacing. Account for font rendering differences across OS while still checking measured geometry and semantic tokens. Pixel differences alone are not proof of a defect.

### Exercise the interaction contract
Follow the primary user flow and a recovery path. Check that visual simplification did not remove controls, lose state or alter account boundaries. Verify pane/summary cooperation, keyboard focus, Escape, scroll anchors, cancellation, disabled/loading feedback and long content where relevant.

### Record and fix drift
Use [templates/fidelity-check.md](templates/fidelity-check.md). Rank missing behavior and clipped content ahead of minor visual differences. Identify the owning component or token and repair shared causes rather than stacking per-screen overrides.

After a repair, rerun the affected state and one sibling surface using the same component. Do not repeatedly broaden regression testing without a new change or concern. Keep screenshots outside committed source unless the project intentionally stores visual fixtures.

## Pitfalls

- Checking only the overview while panels and secondary routes remain different.
- A passing build or successful click presented as fidelity evidence.
- Shrinking real content to match a sparse mock instead of adapting the layout.
- Reporting untested platforms, integrations or accessibility modes as passed.

## Verification

Deliver a concise checked-page/state list, comparison dimensions, material differences fixed, evidence paths and remaining intentional deviations or limitations. Separate functional results from visual matching and name any unavailable reference or browser capability.
