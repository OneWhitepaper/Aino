---
name: product-design-get-context
description: Inspect product code, screens and design constraints.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, product-design-get-context]
    category: creative
    related_skills: [product-design, product-design-user-context, product-design-design-qa]
---

# Product Design Context Inspection Skill

Assemble the current implementation, reference authority and functional constraints before designing. This workflow produces an evidence-based surface inventory rather than a speculative replacement page.

## When to Use

- Begin UI work in an unfamiliar repository or product.
- A design preview differs from implementation and the source of truth is unclear.
- Need a targeted map of routes, component families, data ownership and runtime states.

## Prerequisites

- A real product brief or current repository, screen, URL or design artifact.
- Use `read_file` and `search_files` to inspect product context and actual implementation; use `patch` for authorized file changes and `terminal` for existing project scripts.
- Use available `desktop_preview` / `drive_preview` or `browser_exec` for observed behavior and screenshots. A missing browser is a verification limitation, not proof of a working page.
- Optional `image_generate` requires an available provider; use actual tool results, not imaginary generated assets.

## How to Run

1. Read repository/area instructions and inspect the relevant app entry points.
2. Open the actual requested surface and record its states.
3. Extract design tokens, shared controls and functional dependencies.
4. Produce a scoped context brief and resolve reference conflicts from evidence.

## Quick Reference

| Evidence | Record |
|---|---|
| Source | Revision, routes, feature components, state stores |
| Runtime | URL/build, window size, theme, account mode |
| Reference | Approved artifact, version/date, requested match |
| Design system | Token files, type/icon/control families |
| Behavior | Destination, state change, persistence, recovery |
| Constraints | Permissions, data boundaries, platform limitations |

## Procedure

### Read the local structure
Use `search_files` for entry points, routing, theme files and component names. Read relevant area instructions before editing. Inspect package scripts and existing tests. Avoid dumping the whole repository when a feature's boundaries can be traced directly.

### Observe the actual application
Open/read the intended page through the available preview/browser tools. Confirm the app/build identity. Inspect normal, opened-panel, selected-item, loading/error and empty states relevant to the request. Keep a route and state list; a screenshot of the default page does not represent all behavior.

Inventory each visible control: label/icon, action, destination, state owner and affected data. Note duplicated entry points and hidden dependencies. Distinguish genuine missing behavior from a disabled action whose prerequisites are absent.

### Extract the visual vocabulary
Read theme tokens and representative controls. Record type size/weight/line-height, spacing, pane insets, surface colors, divider rules, radii, icons, hit areas and motion. Compare current implementation to approved designs and note where actual code has drifted.

### Resolve source of truth
The latest explicit user instruction and approved artifact determine the target. Source explains existing behavior; a new mock should not silently override it. Flag conflicts that materially change function. For a layout-only request, preserve identity, data scope and routes.

### Write a usable handoff
Use [templates/surface-inventory.md](templates/surface-inventory.md). Include concrete file paths and route/state names, not a generic list of design principles. Describe what can be changed locally and what relies on external APIs, live accounts or unavailable platforms.

Keep evidence fresh. If the runtime is unavailable, identify committed screenshot dates and validate them against current tokens/components. Do not claim they are the current rendered application without corroboration.

## Pitfalls

- Building before observing the real page.
- Treating a stale concept or isolated component screenshot as the entire product.
- Reading another profile's private history to fill missing context.
- Calling unconfigured design MCP or browser APIs by guessed names.

## Verification

The inventory covers the requested routes and states, identifies existing components and data boundaries, and names the approved target. Each important claim points to code, runtime evidence or supplied material. Clearly list what could not be observed.
