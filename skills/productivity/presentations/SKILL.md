---
name: presentations
description: Build editable slide decks and inspect their layout.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [presentations, productivity]
    category: productivity
    related_skills: [microsoft-office, pdf, imagegen]
---

# Presentations Skill

Build and revise editable PowerPoint decks with Aino's existing Office toolchain. Use slide structure, rendered evidence, and supplied brand templates rather than a proprietary hosted slide runtime.

## When to Use

Use for `.pptx` decks, slide updates, template-based presentations, speaker notes, chart replacement, and layout review.

## Prerequisites

- Load `microsoft-office` and its `references/powerpoint.md` with `skill_view`.
- Use the pinned documents environment described by that skill, with `pptx` installed.
- For Chinese and other non-Latin slides, explicitly select an installed CJK/script-compatible font in the theme and text styles; inspect rendered glyphs for missing-font squares.
- LibreOffice plus poppler are optional for slide images. Without them, validate structure and disclose the missing visual check.

## How to Run

Resolve `microsoft-office`'s installed `skill_dir`. Run its helpers through `terminal`, consulting `--help` for the exact JSON schema before writing a deck specification.

## Quick Reference

| Need | Helper relative to `microsoft-office` |
| --- | --- |
| Inspect deck / notes | `scripts/pptx_read.py` |
| Create from spec | `scripts/pptx_create.py` |
| Preserve brand template | `scripts/pptx_from_template.py` |
| Edit existing deck | `scripts/pptx_edit.py` |
| Render to images | `scripts/pptx_render.py` |

Use `imagegen` for requested raster assets and `pdf` for exported PDF inspection.

## Procedure

1. Establish audience, delivery length, key decision, aspect ratio, and editable output requirements from the task.
2. Inspect supplied deck masters, layouts, theme colors, fonts, and notes before choosing a template. Preserve the template's styling contract.
3. Outline one takeaway per slide. Separate narration from visible text; do not compress a document paragraph onto every slide.
4. Create editable text, shapes, tables, and charts where supported. Use image assets for material that genuinely benefits from raster output.
5. Keep a consistent grid, title position, readable type size, and visual hierarchy. Reserve safe margins and use the same chart scales for comparisons.
6. Render and inspect each slide if rendering is available; correct clipping, text overflow, overlap, poor contrast, and missing fonts.
7. Re-read slide count, order, text, notes, and important data values. Deliver the final `.pptx` and any requested preview/export.

## Pitfalls

- Rendering an image of every slide into a deck destroys editability.
- Generic layouts may not preserve a supplied theme; use the template helper.
- A helper reporting missing LibreOffice is not a successful visual review.
- Do not fabricate chart values or silently drop notes.

## Verification

Open/read the output with `pptx_read.py`; verify content and slide order against the outline. Inspect rendered first, middle, last, and every changed slide, and confirm the editable source remains available.
