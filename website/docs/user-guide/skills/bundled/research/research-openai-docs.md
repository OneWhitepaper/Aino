---
title: "Openai Docs — Find current official OpenAI product and API guidance"
sidebar_label: "Openai Docs"
description: "Find current official OpenAI product and API guidance"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Openai Docs

Find current official OpenAI product and API guidance.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/research/openai-docs` |
| Version | `1.0.0` |
| Author | OpenAI, Aino contributors |
| License | Apache-2.0 |
| Platforms | linux, macos, windows |
| Tags | `openai-docs`, `research` |
| Related skills | [`openai-platform-api-key`](../../bundled/software-development/software-development-openai-platform-api-key.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# OpenAI Documentation Skill

Answer OpenAI product and API questions from current official documentation. Keep OpenAI product behavior separate from Aino's actual code and available tools.

## When to Use

Use for OpenAI API onboarding, supported parameters and model migrations, Codex/ChatGPT behavior questions, and official troubleshooting sources.

## Prerequisites

- `web_search` and `web_extract`, or an explicitly configured official documentation MCP server.
- Identify the product, endpoint/SDK, model, client surface, and version relevant to the question.
- For Aino integration questions, inspect the local adapter and configuration using `search_files` and `read_file`.

## How to Run

Search official domains, open the relevant guide, and cite the page supporting the answer. Use `terminal` only for authorized local examples and SDK verification, with secrets supplied through existing configuration.

## Quick Reference

| Question | Starting source |
| --- | --- |
| API onboarding | https://developers.openai.com/api/docs/quickstart |
| API references | https://developers.openai.com/api/reference |
| Codex client / agent | https://developers.openai.com/codex |
| API platform | https://platform.openai.com |

Prefer the specific guide and changelog for the target version over remembered defaults.

## Procedure

1. Resolve the user's product and concrete outcome; distinguish first integration from an existing application migration.
2. Search/read current official material and inspect relevant local code. Record date-sensitive claims and supported platform/version boundaries.
3. For migrations, compare request fields, tool/image formats, streaming events, model availability, and supported response handling before editing.
4. Preserve the user's chosen provider/model and working behavior unless a documented incompatibility requires change.
5. Build the smallest relevant example using the project's current SDK or HTTP layer. Validate locally without live API calls unless those calls are authorized.
6. Cite official URLs and separate documented facts, observed local behavior, and remaining uncertainty.

## Pitfalls

- OpenAI documentation does not establish which features Aino implements.
- Do not invent private Codex APIs, entitlements, quotas, or future model names.
- Search snippets alone are insufficient evidence for exact parameter support.
- Never include API keys or authorization headers in examples or logs.

## Verification

Check that each material product claim has an official source, links match the requested surface, and code uses documented parameters supported by the installed SDK.

## Attribution

Adapted from OpenAI openai-docs under Apache-2.0, using Aino web and file tools.
