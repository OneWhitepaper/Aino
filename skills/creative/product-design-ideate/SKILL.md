---
name: product-design-ideate
description: Explore interactive design alternatives for real tasks.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, product-design-ideate]
    category: creative
    related_skills: [product-design, frontend-app-builder, visualize]
---

# Product Design Ideation Skill

Generate a small set of meaningfully different solutions grounded in the current product and user task. Make alternatives comparable and interactive so selection reflects behavior and tradeoffs rather than isolated attractive screenshots.

## When to Use

- A new flow or unclear interaction has more than one plausible design.
- A user asks for options, a prototype or a visual direction before implementation.
- A specific interface needs simplification while preserving capability.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Read the current surface and define the problem and nonnegotiable behavior.
2. Choose two or three distinct interaction/composition hypotheses.
3. Build a comparable local prototype with representative content and real local state.
4. Evaluate each against task success, clarity, accessibility and implementation cost.

## Quick Reference

| Vary deliberately | Keep comparable |
|---|---|
| Disclosure: inline / panel / page | Same task and data |
| Navigation grouping | Same destinations and permissions |
| Density and hierarchy | Same amount of meaningful content |
| Progress/result arrangement | Same asynchronous states |
| Visual treatment within brief | Approved brand and factual copy |

## Procedure

### Establish the design problem
State the observed friction, user goal and success condition. Inspect current code and runtime before proposing a new shell. List capabilities, integrations and keyboard behavior that must survive. If a direction is already approved, refine it instead of restarting option generation.

### Define distinct hypotheses
Each option should change a meaningful organizing idea: a dedicated page versus a contextual panel, a compact timeline versus progressive process disclosure, grouped navigation versus a mode-specific list. Changing only accent colors is not meaningful ideation.

Explain the intended benefit and tradeoff. Favor the smallest set that can answer the user's decision. Avoid using unrelated product features to make one option look richer.

### Build the interaction
Reuse the project's stack where practical, or create a self-contained local HTML prototype. Provide a clear variant switch that does not masquerade as a product control. Make selection, opening/closing, filters, forms and state transitions actually work with local data. Include loading/error/cancel states that affect the design.

Use the same representative data and viewport for each variant. Long names, enough rows and opened panels prevent a sparse demo from hiding density problems. Match approved colors and component families unless changing them is explicitly in scope.

Use `image_generate` only when raster art helps the question and a provider is configured. An image-only concept does not validate interaction. Deliver a saved HTML via Aino's supported `::preview{file="/absolute/path/concept.html"}` when available, or a local server/HTML artifact with its real path.

### Evaluate and converge
Follow the same scenario through every variant. Record action count, information visibility, recovery and focus behavior without pretending a prototype is a statistically valid user test. Recommend an option with concrete reasons tied to the goal.

Carry the selected concept into a brief/state inventory and keep the artifact version. Do not silently merge incompatible pieces from all options into a cluttered final design.

## Pitfalls

- Options differ only cosmetically or use different amounts of content.
- Designing a generic landing page for an existing app problem.
- Inert buttons, impossible success states and hidden required steps.
- Calling a preference vote a measured usability study.

## Verification

Open the prototype, exercise every variant's primary path and one recovery state, inspect narrow layout and keyboard behavior, and compare the same content at the same dimensions. Deliver the artifact and explain mock integrations, recommendation and unresolved tradeoffs.
