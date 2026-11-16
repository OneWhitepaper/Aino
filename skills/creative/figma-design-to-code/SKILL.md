---
name: figma-design-to-code
description: Implement Figma designs with verified visual fidelity.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [design, frontend, figma-design-to-code]
    category: creative
    related_skills: [figma-use, frontend-app-builder, product-design-design-qa]
---

# Figma Design to Code Skill

Implement an authorized Figma frame or component in the existing application using observed design data and rendered comparison. Reuse the product's components and state architecture while preserving the approved design's geometry, typography and interaction intent.

## When to Use

- A Figma URL/frame/component should become a working app surface.
- Existing UI needs alignment with an approved Figma design.
- Build reusable components and states from real design variants.

## Prerequisites

- A user-supplied Figma file/node URL and permission to access the requested design.
- Aino's configured Figma MCP server and authenticated account, or authorized exported design data/screenshots. Inspect the tools actually advertised in the session before calling them.
- The existing MCP setup path supports `hermes mcp install figma`, then `hermes mcp login figma`, run through `terminal` in the intended profile when setup is authorized. Aino's MCP settings can also manage the connection. Internal `hermes` command names are retained for compatibility.
- The hosted endpoint is `https://mcp.figma.com/mcp`; confirm current official setup and available scopes/tools. Authentication may require user interaction. A skill does not supply a Figma account, token, plan entitlement or write tool.
- Use `read_file`, `search_files`, `patch` and `terminal` for local artifacts. Do not print secrets, put tokens in source files or invent Codex `use_figma` execution APIs.

## How to Run

1. Use `figma-use` to establish the exact authorized file/node and available design data.
2. Obtain layout/context and a visual render or supplied export.
3. Map design styles/components to the project's existing tokens and controls.
4. Implement, render at comparable dimensions and repair mismatches.

## Quick Reference

| Design input | Implementation concern |
|---|---|
| Auto layout / constraints | Flex/grid sizing and responsive behavior |
| Text styles | Font loading, metrics, wrapping and fallback |
| Variables/styles | Semantic token mapping and theme support |
| Components/variants | Shared control API and state coverage |
| Clips/effects/assets | Layering, overflow, crop and performance |
| Prototype links | Navigation and state transitions |

## Procedure

### Read context and visual appearance
Inspect the supplied node plus necessary parent context. Use actual advertised Figma MCP tools or authorized exports, never guessed tool names. Obtain a screenshot/render in addition to structured properties when possible. Identify missing fonts, hidden variants and unsupported effects before implementation.

If Figma access is unavailable, use a supplied screenshot or export via `product-design-image-to-code` and explain the information loss. Do not claim structured design extraction occurred from an image alone.

### Inventory the application
Read relevant area instructions, component library, token definitions, package scripts and state stores. Map each design component to an existing primitive or a necessary extension. Preserve routes, account/profile ownership, permissions, keyboard behavior, model/provider configuration and functional integrations.

### Create a design-to-code map
Record node ID, component role, token mapping, dimensions/constraints, visible copy and implementation path. Use [templates/node-map.md](templates/node-map.md). Extract actual assets through authorized tools where possible; preserve licenses and exact icon styles. Do not replace a real logo or complex artwork with an approximate drawing.

### Implement behavior as well as appearance
Use semantic controls, shared styles and responsive structure. Interpret auto layout as rules, not a demand for absolute pixel positioning. Map Figma variants to default, hover, focus, selected, disabled, loading and error states where defined. For missing states, reuse the product's established patterns and note assumptions.

Prototype links express intent; they do not supply backend code. Wire real authorized integrations through existing APIs, or label local mock behavior. Keep final result and task hierarchy clear when process details or side panels are involved.

### Compare the rendered result
Run existing type/lint/build checks. Render at the design frame's dimensions and inspect type metrics, copy, container edges, spacing, icons, colors, borders, radii, asset crop and effect weight. Check opened panels/menus and relevant component variants, then narrow layout, keyboard and reduced motion.

Use `product-design-design-qa` for a written mismatch ledger. Fix structural differences before cosmetic details and rerun the affected flow. Explain intentional functional/platform adaptations rather than hiding them under a fidelity claim.

## Pitfalls

- Implementing only the default frame while ignoring visible component variants.
- Guessing fonts/assets or overriding the existing account/state architecture.
- Treating Figma auto layout as a flat screenshot with fixed coordinates.
- Assuming a successful build means the rendered design matches.
- Claiming unavailable Figma writing or export tools are part of this skill.

## Verification

Deliver the file/node reference, implementation files, asset/token map, tested interactions and matched viewport evidence. Compare at least five concrete visual landmarks and identify unverified design states, missing access or integration limits. Verify local behavior separately from visual matching.
