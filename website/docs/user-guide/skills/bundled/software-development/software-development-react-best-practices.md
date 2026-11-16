---
title: "React Best Practices — Improve React rendering, data flow and bundle performance"
sidebar_label: "React Best Practices"
description: "Improve React rendering, data flow and bundle performance"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# React Best Practices

Improve React rendering, data flow and bundle performance.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/react-best-practices` |
| Version | `1.0.0` |
| Author | Vercel Engineering; Aino contributors (native adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `react-best-practices` |
| Related skills | [`frontend-testing-debugging`](../../bundled/software-development/software-development-frontend-testing-debugging.md), [`frontend-app-builder`](../../bundled/software-development/software-development-frontend-app-builder.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# React Best Practices Skill

Apply Vercel Engineering's React and Next.js performance guidance in the order of measured impact. The bundled rule files include explanations and contrasting code examples; use only rules compatible with the project's framework and version.

## When to Use

- Implement or review React components, hooks, stores and Next.js routes.
- Investigate slow startup, streaming jank, repeated fetches, heavy bundles or unnecessary renders.
- Refactor a performance hotspot while preserving behavior and accessibility.

## Prerequisites

- Inspect the installed React/Next.js versions, build system and existing state architecture with `read_file` and `search_files`.
- Use `terminal` for the project's profiling, type, build and behavioral tests; `patch` for focused changes.
- Use available `drive_preview` or `browser_exec` to verify the actual visible interaction. Desktop/Electron and plain React projects do not automatically have Next.js server components or server actions.
- No external service or new library is required by this skill. Prefer existing data/cache tooling before adding dependencies.

## How to Run

1. Reproduce a specific slow interaction or loading path and record a baseline.
2. Classify it using the priority table below.
3. Read the matching files in `rules/`, apply the relevant technique and test the behavior.
4. Remeasure the same path with comparable data and report the observed difference.

## Quick Reference

| Priority | Topic | Rule prefix | Start here |
|---|---|---|---|
| 1 | Async waterfalls | `async-` | [Parallel independent work](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/async-parallel.md) |
| 2 | Initial bundle | `bundle-` | [Conditional loading](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/bundle-conditional.md) |
| 3 | Server rendering/data | `server-` | [Minimize serialization](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/server-serialization.md) |
| 4 | Client fetching | `client-` | [Deduplicate listeners](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/client-event-listeners.md) |
| 5 | Render subscriptions | `rerender-` | [Split independent hooks](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/rerender-split-combined-hooks.md) |
| 6 | Browser painting | `rendering-` | [Long content visibility](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/rendering-content-visibility.md) |
| 7 | Hot JavaScript | `js-` | [Indexed lookups](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/js-index-maps.md) |
| 8 | Specialized patterns | `advanced-` | [Initialize once](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/react-best-practices/rules/advanced-init-once.md) |

## Procedure

### Establish the bottleneck
Record route, data size, timing and interaction. Separate network latency, backend work, JavaScript parse/execute, React reconciliation, style/layout and paint. Use React Profiler, browser performance tooling or existing instrumentation when available; do not invent a measured improvement from source inspection.

### Remove structural costs first
Start independent requests concurrently and await only where their results are needed. Keep cancellation and error semantics intact. Load heavy editors/charts and optional settings panes when activated. Check direct imports and bundle output before changing packaging. Never move authorization or secret-bearing work to a client component to improve startup.

### Limit state propagation
Use narrow store selectors and subscriptions; preserve feature-owned state. Derive values during rendering when they do not require an external effect. Keep transient pointer/scroll values out of app-wide state. Stabilize component identity and keys. Split expensive independent views before adding memoization; unnecessary `useMemo` and `useCallback` can increase complexity without reducing work.

### Preserve responsiveness
Use transitions/deferred values for nonurgent expensive updates while keeping typing immediate. Avoid unbounded Markdown reprocessing, synchronous storage reads in hot renders and repeated layout reads/writes. Test panel open/close, streaming output, conversation switching and long lists with representative data.

### Apply framework-specific rules only where valid
Check installed API support before adopting Activity, server caching, `after`, resource hints or server-action advice. Per-request and cross-request caches have different account-isolation and invalidation rules. Include profile/account in cache ownership where required, and clear sensitive state at the existing account boundary.

### Verify the improvement
Run the relevant behavior and build checks. Reproduce the baseline path, inspect rendered output and compare timings/profile evidence. Confirm loading/error/cancel behavior, navigation state, scroll and accessibility remain correct. Keep only optimizations that remove a demonstrated cost or simplify the implementation.

## Pitfalls

- Treating all 64 rules as mandatory rewrites without profiling.
- Importing a Next.js-only pattern into Electron/Vite or relying on a newer React API than installed.
- Caching account-specific results globally or suppressing hydration warnings to hide a real mismatch.
- Changing semantic state to a ref when React must render it.
- Measuring a warm cache against a cold baseline and presenting the difference as a code improvement.

## Verification

Name the rule files used, baseline and post-change evidence, tests run and visible flow checked. Report source-only improvements as unmeasured until runtime evidence exists. Preserve actual behavior, data ownership, keyboard interaction and error recovery.
