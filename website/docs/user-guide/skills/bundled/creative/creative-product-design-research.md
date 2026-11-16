---
title: "Product Design Research — Research interface patterns using traceable sources"
sidebar_label: "Product Design Research"
description: "Research interface patterns using traceable sources"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Product Design Research

Research interface patterns using traceable sources.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/creative/product-design-research` |
| Version | `1.0.0` |
| Author | Aino contributors |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `product-design-research` |
| Related skills | [`product-design-user-context`](../../bundled/creative/creative-product-design-user-context.md), [`product-design-audit`](../../bundled/creative/creative-product-design-audit.md), [`product-design`](../../bundled/creative/creative-product-design.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Product Design Research Skill

Gather trustworthy product and interaction evidence for a concrete design decision. Keep source-backed observations separate from recommendations, and never fabricate interviews, experiments or usage data.

## When to Use

- Compare an interaction pattern, accessibility requirement or platform convention.
- A design decision needs official documentation or public product evidence.
- Existing user research must be synthesized into implementation constraints.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Write the decision and the evidence needed to resolve it.
2. Collect current authoritative documentation and directly observed public examples.
3. Compare options under the product's actual constraints.
4. Produce cited conclusions, uncertainties and testable next steps.

## Quick Reference

| Evidence type | Use | Limit |
|---|---|---|
| Official platform/standard docs | API, accessibility, native convention | May not describe the user's context |
| Direct product observation | Actual flow, labels and behavior | Build/account/region may differ |
| Published study | Research results and methodology | Sample and date constrain transfer |
| User-supplied feedback | Concrete reported difficulty | Anecdote unless broader evidence exists |
| Heuristic reasoning | Design hypothesis | Must be labeled as inference |

## Procedure

### Scope the question
Identify the decision, audience, task, platform and constraints. Ask what evidence would change the recommendation. Avoid broad research when the current code and one reproduction already answer a narrow defect.

### Select sources
Use available `web_search` / `web_extract` for documentation and public material, or `browser_exec` / native preview to observe an authorized page. Prefer official platform guides, standards, primary research and first-party product documentation. Record title, URL, publication/version and access date.

If external access is unavailable, synthesize the supplied documents and label the scope. Do not invent links, citations or current product behavior from memory. A search snippet is a lead; read the relevant page before treating it as decisive evidence.

### Observe comparable tasks
Compare the same job and state across products. Document navigation, primary action, feedback, error recovery, keyboard support and narrow-layout behavior. Note where login, geography or feature flags prevent verification. Do not bypass access controls or use private account information without task authorization.

### Synthesize the decision
Build an evidence table: claim, source/observation, relevance, uncertainty and implication. Separate normative requirements from common patterns and preferences. A familiar pattern is useful evidence but not proof that copying it suits this product.

### Translate into work
Recommend a direction and name its tradeoffs. Turn conclusions into concrete design constraints and acceptance tests. Identify what should be validated locally rather than claiming public documentation proves the implementation works. Keep factual source attribution in the final artifact.

## Pitfalls

- Invented user studies, percentages or claims of certification.
- Quoting secondary summaries as if they were official requirements.
- Copying a competitor's assets or private content instead of analyzing the pattern.
- Treating old documentation as the behavior of the installed version.

## Verification

Every material factual claim has a real source or direct observation. Recommendations show their reasoning and uncertainty. Cite usable URLs, distinguish tested from inferred behavior, and identify follow-up validation needed in the real product.
