---
title: "Aino Built-in Workflow Skills"
description: "Invocation names, provenance, and dependencies for 49 skills"
---

# Aino Built-in Workflow Skills

This collection maps 49 requested skill identifiers to Aino's existing on-demand skill system. It uses normal discovery, slash commands, bundled distribution, and profile-scoped synchronization. Skills teach workflows; they do not add unavailable runtime tools.

## Use

Find the Aino name below in Skills, invoke `/skill-name` on a supported chat surface, or request the skill in natural language. Ordinary chats and Bots share the loader while preserving each profile's custom edits, deletions, disabled skills, and opt-out preferences.

The launch profile uses normal startup synchronization. Existing Bot profiles receive bundled additions when first served by the desktop runtime. Use a new chat or the existing controlled refresh path for the new index; upgrading does not rewrite cached system prompts in active conversations.

## Provenance and dependencies

**Adapted** entries reuse redistributable MIT/Apache-2.0 material with attribution and Aino-native tool interfaces. **Native** entries are independently authored Aino workflows: proprietary Codex services, restricted assets, and private APIs are not included. **Reused** entries use an existing Aino package.

Figma requires authorized MCP/API access; CodeRabbit, Playwright, and HyperFrames need their external CLI/runtime. Image generation needs a configured provider. Chronicle organizes authorized current observations and supplied records; it does not provide background screen-history recording. Office/PDF tasks use existing bundled helpers and the pinned PM documents environment. For Chinese exports, select installed CJK fonts and inspect rendered glyphs.

## Mapping

The three macOS-only skills are platform-gated on Windows/Linux. Conditions below do not imply automatic installation of external software.

| Requested identifier | Aino name | Integration | Conditions |
| --- | --- | --- | --- |
| `superpowers:systematic-debugging` | `systematic-debugging` | reused | Aino native tools |
| `superpowers:verification-before-completion` | `verification-before-completion` | adapted | Aino native tools |
| `superpowers:test-driven-development` | `test-driven-development` | reused | Aino native tools |
| `build-web-apps:frontend-testing-debugging` | `frontend-testing-debugging` | adapted | Project frontend test/browser toolchain |
| `superpowers:using-superpowers` | `using-superpowers` | adapted | Aino native tools |
| `superpowers:brainstorming` | `brainstorming` | adapted | Aino native tools |
| `playwright` | `playwright` | adapted | Node.js/npm and installed Playwright CLI/browser |
| `impeccable` | `impeccable` | adapted | Aino native tools |
| `superpowers:finishing-a-development-branch` | `finishing-a-development-branch` | adapted | Git repository and project validation commands |
| `superpowers:executing-plans` | `executing-plans` | adapted | Aino native tools |
| `build-web-apps:frontend-app-builder` | `frontend-app-builder` | adapted | Project frontend toolchain |
| `superpowers:subagent-driven-development` | `subagent-driven-development` | adapted | delegate_task when available; otherwise explicit sequential execution |
| `superpowers:requesting-code-review` | `requesting-code-review` | reused | Git repository; delegate_task for an independent reviewer when available |
| `superpowers:using-git-worktrees` | `using-git-worktrees` | adapted | Git repository |
| `build-web-apps:react-best-practices` | `react-best-practices` | adapted | React/Next.js project for code application |
| `product-design:index` | `product-design` | native | Aino native tools |
| `superpowers:writing-plans` | `writing-plans` | adapted | Aino native tools |
| `product-design:user-context` | `product-design-user-context` | native | Aino native tools |
| `build-macos-apps:packaging-notarization` | `packaging-notarization` | adapted | macOS; Xcode command-line tools; distribution identity/keychain profile for an authorized release |
| `visualize:visualize` | `visualize` | native | Local HTML-capable preview for interactive artifacts |
| `product-design:image-to-code` | `product-design-image-to-code` | native | Aino native tools |
| `superpowers:dispatching-parallel-agents` | `dispatching-parallel-agents` | adapted | delegate_task when available |
| `superpowers:receiving-code-review` | `receiving-code-review` | adapted | Aino native tools |
| `documents:documents` | `documents` | native | PM documents environment; LibreOffice and installed CJK fonts for Chinese layout verification |
| `imagegen` | `imagegen` | adapted | Configured image_generate provider |
| `openai-docs` | `openai-docs` | adapted | Web search/extraction or official documentation MCP |
| `build-macos-apps:build-run-debug` | `build-run-debug` | adapted | macOS; Xcode or Swift toolchain |
| `design-taste-frontend` | `design-taste-frontend` | adapted | Aino native tools |
| `product-design:audit` | `product-design-audit` | native | Aino native tools |
| `product-design:ideate` | `product-design-ideate` | native | Aino native tools |
| `product-design:get-context` | `product-design-get-context` | native | Aino native tools |
| `chronicle` | `chronicle` | native | Authorized current screen observations or user-supplied records; no background screen history |
| `figma:figma-use` | `figma-use` | native | Configured Figma MCP or authorized Figma API access |
| `product-design:design-qa` | `product-design-design-qa` | native | Aino native tools |
| `figma:figma-design-to-code` | `figma-design-to-code` | native | Configured Figma MCP/API or supplied design export; Project UI/browser tooling |
| `coderabbit:coderabbit-review` | `coderabbit-review` | adapted | Installed CodeRabbit CLI; CodeRabbit authentication/service |
| `computer-use:computer-use` | `computer-use` | reused | Configured cua-driver computer_use backend and host permissions |
| `presentations:presentations` | `presentations` | native | PM documents environment; LibreOffice/poppler and installed CJK fonts for Chinese slide verification |
| `browser:control-in-app-browser` | `control-in-app-browser` | native | Aino desktop desktop_ui tools and selected tab |
| `openai-developers:openai-platform-api-key` | `openai-platform-api-key` | native | User-owned provider/project credential destination |
| `build-macos-apps:signing-entitlements` | `signing-entitlements` | adapted | macOS; Apple code-signing tools |
| `skill-creator` | `skill-creator` | adapted | Aino native tools |
| `skill-installer` | `skill-installer` | adapted | Aino native tools |
| `product-design:research` | `product-design-research` | native | Aino native tools |
| `codex-security:security-scan` | `security-scan` | native | Aino native tools |
| `hyperframes:hyperframes` | `hyperframes` | adapted | Node.js 22+; Project-local HyperFrames CLI; FFmpeg; Supported rendering browser |
| `pdf:pdf` | `pdf` | reused | PM documents environment; OCR tools only for scanned inputs |
| `codex-security:triage-finding` | `triage-finding` | native | Aino native tools |
| `product-design:url-to-code` | `product-design-url-to-code` | native | Authorized source URL and web/browser observation tools |

Each package retains its license/attribution. `skills/aino-builtin-catalog.json` records this mapping and dependencies; it is an inventory, not a parallel runtime registry.
