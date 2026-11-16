---
title: "Imagegen — Generate or edit raster assets with configured models"
sidebar_label: "Imagegen"
description: "Generate or edit raster assets with configured models"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Imagegen

Generate or edit raster assets with configured models.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/imagegen` |
| Version | `1.0.0` |
| Author | OpenAI, Aino contributors |
| License | Apache-2.0 |
| Platforms | linux, macos, windows |
| Tags | `imagegen`, `creative` |
| Related skills | [`design-taste-frontend`](../../bundled/creative/creative-design-taste-frontend.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Image Generation Skill

Generate images and variants using Aino's configured `image_generate` provider. Preserve editing invariants and verify actual output; the provider's current tool schema determines which edit and reference options are supported.

## When to Use

Use for photos, illustrations, textures, concept art, raster mockups, and requested image edits. Prefer existing editable SVG or UI components when the user's task is a code-native icon or interface change.

## Prerequisites

- `image_generate` must be available with an image provider configured in Aino.
- Editing/reference images require capabilities advertised by that provider; do not invent parameters.
- Use existing configured credentials. Never copy keys from chat into skill files or ask to paste secrets in chat.

## How to Run

Call `image_generate` with `prompt` and a supported `aspect_ratio`. Add reference/edit controls only if present in this session's schema. Use `vision_analyze` to inspect outputs when available.

## Quick Reference

```text
image_generate(prompt="Product photograph of a ceramic mug on a warm neutral background; soft side light, no text or logos", aspect_ratio="square")
```

Prompt checklist: intended use, subject, composition, medium, lighting, palette, exact text, constraints. Keep controls such as model and size in supported tool arguments rather than assuming prompt text configures them.

## Procedure

1. Decide whether the task is generation, reference-guided generation, or editing an existing asset.
2. Extract the user's exact requirements. For edits, list elements to change and invariants to preserve; for UI assets, inspect the surrounding design first.
3. Write a focused prompt with composition, palette, output use, and verbatim text when required. Avoid adding unrelated subject matter.
4. Generate the requested number of assets through the configured tool. Do not silently switch provider/model after a failure.
5. Inspect each result for incorrect text, missing transparency, cropping, identity changes, and visual artifacts. Iterate with one purposeful change at a time.
6. Preserve the selected file in the user's requested project/artifact location and present an actual image preview and usable path.

## Pitfalls

- A checkerboard painted into pixels is not an alpha channel; verify transparency when required.
- Reference guidance and in-place editing are different capabilities.
- Avoid forcing OpenAI credentials for a working alternative provider.
- A failed tool call is not a generated image; report the actionable provider error.

## Verification

Confirm the output file exists and is decodable; inspect its dimensions, alpha if requested, and visible content. For edits compare the preserved elements with the input. Report any remaining mismatch.

## Attribution

Adapted from OpenAI imagegen under Apache-2.0; tool routing and provider controls are implemented for Aino.
