---
title: "Product Design Image To Code — Implement interface screenshots in the existing stack"
sidebar_label: "Product Design Image To Code"
description: "Implement interface screenshots in the existing stack"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Product Design Image To Code

Implement interface screenshots in the existing stack.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/product-design-image-to-code` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `product-design-image-to-code` |
| Related skills | [`frontend-app-builder`](../../bundled/software-development/software-development-frontend-app-builder.md), [`product-design-design-qa`](../../bundled/creative/creative-product-design-design-qa.md), [`product-design-get-context`](../../bundled/creative/creative-product-design-get-context.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Product Design Image to Code Skill

Translate a supplied interface image into a working frontend while preserving its visual anatomy and the product's real behavior. Infer only what the image cannot show, and keep those assumptions distinct from observed layout and content.

## When to Use

- Implement an approved UI screenshot, mockup or image-based concept.
- Bring existing pages into alignment with a supplied design.
- Reconstruct a component's layout, iconography and visual states from a reference.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Inspect the image at its native dimensions and the current app/source.
2. Map visible regions to existing components, tokens and behavior.
3. Implement the layout and representative interactions in the real stack.
4. Render at matched dimensions, compare landmarks and repair drift.

## Quick Reference

| Image evidence | Implementation decision |
|---|---|
| Pane/header edges | Container/grid anatomy and shared dimensions |
| Text scale/wrapping | Font metrics, line-height, measure |
| Control shape/spacing | Shared component variants and hit areas |
| Repeated rows/data | Density and representative state |
| Crop and imagery | Asset map, sizing and object fit |
| Selection/overlay | State model and stacking ownership |

## Procedure

### Inspect before interpreting
Use the image-understanding capability available in the current session, or `vision_analyze` on the supplied image when available. Record its dimensions, visible text, region boundaries and uncertain details. Read actual UI source and tokens so the implementation fits the product rather than becoming an unrelated static page.

If the image cannot be viewed, complete source inspection and clearly identify the missing evidence. Do not fabricate pixel values or claim a screenshot comparison without seeing it.

### Build an anatomy and asset map
Identify navigation, headers, content, controls, panels, overlays and backgrounds. Estimate shared spacing and type ratios, then verify with computed/rendered output. Reuse real source icons/logos/assets where present. Do not redraw complex branded raster artwork as approximate CSS.

Record visible copy exactly when the user requests fidelity. Keep the real product's functional constraints and data ownership. For unseen responsive or error states, use the existing product's patterns and label the inferred behavior.

### Implement in the native stack
Use existing shared primitives and semantic tokens. Preserve routes, state stores, profile/account isolation, permissions and tool integrations. Use semantic controls and responsive structure, not absolute positioning for every visible element.

A prototype may implement local data and realistic interactions, but cannot imply live persistence or authentication. Generated art is useful only when assets are absent, authorized and a provider is available; it is not a substitute for accurate UI structure.

### Compare at the right scale
Render at the image's dimensions and representative narrow sizes. Compare container edges, type baselines and wrapping, icon weight, border/radius, surface tones, whitespace, data density and asset crop. For a multi-state concept, inspect each requested state.

Repair the largest structural differences before fine color details. Preserve legibility and usable targets when adapting across dimensions. Track mismatches with `product-design-design-qa` rather than declaring fidelity from a build result.

## Pitfalls

- Inventing invisible functionality or changing approved copy without reason.
- Fixed screenshot-sized positioning that collapses on another window size.
- Generic icons, gradients or placeholder art replacing the visual reference.
- Ignoring existing backend/state logic while recreating the appearance.

## Verification

Verify the artifact exists, the app runs, the primary interaction works, and rendered comparisons cover at least layout, typography, icons, color and spacing. State exact reference/implementation paths and remaining inferred or unverified behavior.
