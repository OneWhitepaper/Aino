---
name: product-design-url-to-code
description: Recreate observed web interfaces as local frontends.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, product-design-url-to-code]
    category: creative
    related_skills: [frontend-app-builder, product-design-design-qa, product-design-research]
---

# Product Design URL to Code Skill

Implement a local frontend from an observed website or page, using direct visual and interaction evidence. Preserve the requested structure and behavior while accurately identifying any unavailable backend, private content or external integration.

## When to Use

- Recreate a supplied public page or authorized product surface locally.
- Implement a reference site's general layout and interactions in the project's stack.
- Compare a current webpage to a local implementation for fidelity.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Open the exact supplied URL in an available browser and confirm its identity.
2. Inspect relevant sections, states, responsive behavior and assets.
3. Build the authorized local frontend with representative data and working controls.
4. Compare matched screenshots and state transitions; identify integration limits.

## Quick Reference

| Observe | Capture for implementation |
|---|---|
| First viewport | Navigation, title, main action, density |
| Scroll/sections | Order, spacing, sticky behavior |
| Menus/forms | Trigger, focus, validation, result |
| Responsive | Collapse/order, wrapping, target sizes |
| Assets | Source, dimensions, crop and attribution |
| Backend behavior | What is observable versus mocked |

## Procedure

### Inspect the supplied target
Use available `desktop_preview` / `drive_preview` or `browser_exec` for the exact URL. Confirm final URL, title and page state after redirects. Inspect current content rather than relying on memory of a brand. If the page requires login, use only authorized access; do not bypass access controls or CAPTCHA.

Read enough sections and interactive states to explain the requested surface. Observe hover/focus, menu open/close, form validation, tabs, filters and navigation where relevant. Do not cause live transactions merely to infer frontend behavior.

### Gather usable material
Use public/documented or user-provided assets with appropriate attribution and permissions. Reuse a supplied repository when available. Do not copy secrets, authenticated personal data or server internals into a demo. If an asset cannot be used, document the substitution in delivery notes.

### Define scope truthfully
State which routes and interactions are included. Distinguish frontend state from live account, purchase, search or persistence services. A local frontend can reproduce the observed flow with fixtures, but must not present a simulated server success as a real transaction.

### Implement in the existing environment
Inspect package scripts, components and design tokens. Preserve the reference's structure, content order, type, spacing, icons, surfaces and imagery as requested. Reuse shared components and avoid creating a parallel app framework for one page.

Make primary controls operate on real local state; wire authorized integrations through existing APIs where in scope. Support keyboard focus, narrow layout, loading/error/empty states and safe navigation. Do not ship buttons with unexplained dead ends.

### Verify against direct evidence
Capture the local page at the same dimensions and states as the reference. Compare first viewport and relevant below-the-fold sections, open overlays and responsive adaptations. Use `product-design-design-qa` to record and repair concrete drift. If the external target changes or is inaccessible, record the version/date and limit rather than inventing evidence.

## Pitfalls

- Building from a homepage memory while the user supplied a specific route.
- Confusing a local fixture with a production integration.
- Copying private information, credentials or inaccessible server code.
- Matching only a hero while menus, content density and narrow layouts diverge.

## Verification

Verify the local URL/artifact, primary and recovery interactions, responsive states and reference matching. Report observed target URL/date, implemented routes, assets/substitutions, actual integrations and any unverified behavior.
