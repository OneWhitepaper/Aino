---
name: coderabbit-review
description: Review a scoped diff with the CodeRabbit CLI.
version: 1.0.0
author: CodeRabbit AI, Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [coderabbit-review, software-development]
    category: software-development
    related_skills: [requesting-code-review]
---

# CodeRabbit Review Skill

Run CodeRabbit on an explicitly scoped repository diff, interpret the result, and verify any requested fixes. CodeRabbit is an external service; a manual review is never labeled as a CodeRabbit result.

## When to Use

Use when the user requests CodeRabbit review, reviewing a PR with this service, or an authorized fix/review cycle.

## Prerequisites

- Git repository and an installed `coderabbit` CLI.
- Check `coderabbit --version` and `coderabbit auth status --agent` through `terminal`.
- If missing, consult https://docs.coderabbit.ai/cli/overview for installation and let the user authenticate with the CLI's supported login flow. Do not pipe an unreviewed remote script into a shell.

## How to Run

Use `terminal` from the repository root. Inspect `git status` and the base revision first, then choose the review scope that matches the task.

## Quick Reference

```text
coderabbit review --agent
coderabbit review --agent -t uncommitted
coderabbit review --agent -t committed
coderabbit review --agent --base main
coderabbit review --agent --base-commit <verified-sha>
```

Read repository instructions and `.coderabbit.yaml` if present. Use the CLI's `--help` for version-specific config flags.

## Procedure

1. Determine the intended base/head or uncommitted scope without including unrelated user changes.
2. Check CLI availability and authentication; continue useful local inspection while user-only login is pending.
3. Start the scoped review and retain its process/session identifier. Wait in bounded intervals; communicate meaningful progress and failures.
4. Read all returned findings and inspect the actual code to assess validity, severity, and duplication.
5. Apply only authorized fixes. Do not mechanically accept suggestions that violate intended behavior.
6. Run relevant tests; repeat review only when new changes or unresolved findings justify it.
7. Report the reviewed revision, confirmed findings, fixes, validation, and any service limitations.

## Pitfalls

- Authentication, network, or quota failure is not an empty successful review.
- Do not install globally or change credentials silently.
- Review results become stale after changing the diff; identify the revision actually reviewed.
- Never auto-stage all files or merge/push merely because the review completed.

## Verification

Check the CLI completed successfully and preserve its result separately from local judgment. Verify each applied fix with project tests and disclose unreviewed files or incomplete service coverage.

## Attribution

Adapted from the CodeRabbit MIT-licensed CLI review skill. Aino preserves task authorization and normal progress communication.
