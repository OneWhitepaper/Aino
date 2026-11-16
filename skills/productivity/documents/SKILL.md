---
name: documents
description: Create and revise Word files with reviewable structure.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [documents, productivity]
    category: productivity
    related_skills: [microsoft-office, pdf]
---

# Documents Skill

Create, read, and revise Word documents using Aino's bundled Microsoft Office helpers. Preserve document structure, review markup, and the user's original file; no Codex document service is required.

## When to Use

Use for `.docx` reports, letters, contracts, templates, comments, tracked revisions, and structured document inspection.

## Prerequisites

- Load `microsoft-office` with `skill_view`, then its `references/word.md` and, for markup, `references/revisions-and-comments.md`.
- Use an interpreter already providing `docx`, or the existing pinned environment from `hermes pm environment documents --extra documents --extra documents-pdf` through `terminal`.
- For Chinese and other non-Latin content, select an installed CJK/script-compatible font in the document styles; verify real rendered glyphs, since extraction alone cannot detect missing-font squares.
- Optional LibreOffice for PDF rendering. Legacy `.doc` requires conversion before editing; never rename its extension.

## How to Run

Resolve the helper's actual installed `skill_dir` from `skill_view(name="microsoft-office")`. Use `terminal` to run its scripts with the selected interpreter and `--help` first; paths below are relative to that directory.

## Quick Reference

| Operation | Bundled helper |
| --- | --- |
| Read / structure | `scripts/docx_read.py` |
| Create | `scripts/docx_create.py` |
| Edit text | `scripts/docx_edit.py` |
| Fill placeholders | `scripts/docx_template.py` |
| Track / comments | `scripts/docx_revisions.py`, `scripts/docx_comments.py` |
| Validate package | `scripts/docx_validate.py` |

Use `write_file` for UTF-8 JSON specifications; `read_file` for extracted results.

## Procedure

1. Inspect the source's headings, tables, headers, fields, comments, and revision state before editing. Record what must remain intact.
2. Choose the smallest helper operation that fits. Preserve a source copy and write a separate output for review.
3. For new documents, define audience, section hierarchy, page size, margins, heading styles, and table layout before content generation. Reuse an existing template when supplied.
4. For edits, account for text split across runs; do not substitute raw package XML or flatten structured tables into paragraphs.
5. For review workflows, explicitly distinguish proposed, accepted, and rejected revisions. Preserve existing authorship unless requested otherwise.
6. Validate the resulting package and read it back. Render to PDF when the rendering tools are present, then inspect page breaks, table overflow, headers, and glyphs.
7. Deliver the editable output path and a concise list of meaningful changes. State if visual rendering could not be verified.

## Pitfalls

- Structural validation does not prove page layout; missing fonts can change pagination.
- Field/TOC values may need recalculation in Office or LibreOffice.
- Never remove comments or accept all revisions as a side effect of a text edit.
- Do not install packages into Aino's runtime or PM-owned interpreter with raw pip.

## Verification

Check expected text and table values with `docx_read.py`; run `docx_validate.py`. If rendered, inspect every changed page with `vision_analyze`. Verify the original is unchanged and the final editable artifact opens successfully.
