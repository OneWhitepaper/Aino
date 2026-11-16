---
title: "Visualize — Create interactive explanations and local HTML visuals"
sidebar_label: "Visualize"
description: "Create interactive explanations and local HTML visuals"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Visualize

Create interactive explanations and local HTML visuals.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/visualize` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `visualize` |
| Related skills | [`product-design-ideate`](../../bundled/creative/creative-product-design-ideate.md), [`frontend-app-builder`](../../bundled/software-development/software-development-frontend-app-builder.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Visualize Skill

Turn an explanation, comparison or scenario into a saved interactive HTML artifact that works with Aino's existing preview protocol. Keep the underlying data and assumptions explicit, and use a conventional exported figure when publication or exact static reproduction is the goal.

## When to Use

- Explain a process, tradeoff, schedule, relationship or changing scenario.
- A few meaningful controls help the user explore cause and effect.
- Create a self-contained educational diagram or interactive companion to an answer.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Identify the question the visual should answer and choose the simplest useful representation.
2. Define source data, assumptions, controls and observable outputs.
3. Create a local HTML artifact, using [templates/budget-explorer.html](https://github.com/NousResearch/hermes-agent/blob/main/skills/creative/visualize/templates/budget-explorer.html) only when its additive-budget structure fits.
4. Open and test the real artifact, then deliver it with Aino's supported preview/file protocol.

## Quick Reference

| Question | Suitable representation |
|---|---|
| How do parts connect? | Labeled SVG/HTML diagram |
| How does a parameter affect an outcome? | Inputs + computed chart + data table |
| Which option fits? | Comparable criteria table with optional filtering |
| What happens over time? | Timeline or sequence with explicit states |
| Need publication/shareable figure? | Standard plotting/export artifact |
| Single fact or one-step action? | Plain text; no visual needed |

## Procedure

### Specify the explanation
Write the takeaway, audience and one question the visual helps answer. Choose a representation that encodes the information directly. Do not turn every explanation into a dashboard or make decorative animation compete with the content.

List data sources, units, time ranges and assumptions. Label illustrative data and derived estimates. Use accessible text or a table beside important graphics. Controls must change a meaningful quantity or state, not simply animate an unchanged picture.

### Build a portable artifact
Use `patch` or available file-writing tools to create complete HTML with local CSS/JavaScript and SVG/DOM graphics. Keep the file in the user's authorized project/artifact directory. Avoid remote dependencies unless needed and disclosed; prefer a self-contained document for portability.

Use semantic headings, visible input labels, keyboard-operable controls and a reset state. Keep the layout responsive. Honor `prefers-reduced-motion`, and do not encode meaning only by color. Handle invalid/empty inputs and avoid division by zero or nonfinite chart scales.

Use Aino's injected theme variables with fallbacks: `--foreground`, `--muted-foreground`, `--accent`, `--border`, `--card`. Do not access parent window state or assume a Codex-specific callback, `window.openai`, bridge object or cross-origin permission.

### Deliver using real Aino protocols
When inline preview is available, reference the saved absolute path with `::preview{file="/absolute/path/explanation.html"}`. For a downloadable artifact, use the current Aino file delivery convention such as `MEDIA:/absolute/path/explanation.html`. Desktop browsing uses `desktop_preview` and `drive_preview`; a separate browser uses the actual available browser tools.

This skill does not install a hosted visualization service, follow-up-message bridge or persistent widget state. Persist user choices only through ordinary authorized project/app code when the task requires it. A sandboxed preview may restrict downloads or external network access; provide a separate generated export file when needed instead of claiming browser export succeeded.

### Verify the explanation
Open the artifact, exercise every control and compare computed values with a simple hand calculation. Check reset, extremes, empty/invalid data, labels, units, narrow layout, keyboard focus and reduced motion. For a diagram, verify labels and arrows represent the stated relationships. For a data visual, retain the source values/table so the presentation can be checked.

If rendering tools are unavailable, validate syntax and file completeness and state that interactive visual behavior remains unverified. Do not equate an existing HTML file with a successful visible preview.

## Pitfalls

- Reusing a template whose relationship does not match the user's question.
- Decorative data, fabricated precision or unsourced live claims.
- A host-only protocol or callback copied from another product.
- Canvas-only content with no accessible description or underlying data.
- A screenshot offered as an interactive artifact, or a mock presented as a live integration.

## Verification

Verify file existence, syntax, control behavior, calculations, responsive layout and delivery path. State data sources/assumptions and any browser/preview limits. Show the artifact when supported and provide its real saved path; never fabricate a successful render.
