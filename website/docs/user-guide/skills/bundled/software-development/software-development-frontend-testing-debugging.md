---
title: "Frontend Testing Debugging — Test rendered UI flows and diagnose visual regressions"
sidebar_label: "Frontend Testing Debugging"
description: "Test rendered UI flows and diagnose visual regressions"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Frontend Testing Debugging

Test rendered UI flows and diagnose visual regressions.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/frontend-testing-debugging` |
| Version | `1.0.0` |
| Author | OpenAI; Aino contributors (native adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `frontend`, `frontend-testing-debugging` |
| Related skills | [`systematic-debugging`](../../bundled/software-development/software-development-systematic-debugging.md), [`frontend-app-builder`](../../bundled/software-development/software-development-frontend-app-builder.md), [`react-best-practices`](../../bundled/software-development/software-development-react-best-practices.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Frontend Testing and Debugging Skill

Debug the page users actually interact with, linking a visible symptom to a reproducible cause and a focused repair. A passing build is useful evidence, but does not establish that a layout, focus sequence or asynchronous interaction works.

## When to Use

- A control fails, content flickers, a panel jumps, a page overflows or loading never finishes.
- A frontend change needs behavior, accessibility, responsive or screenshot verification.
- A design reference and implementation disagree; use `frontend-app-builder` for larger redesigns.

## Prerequisites

- Access to the actual repository, its area instructions and a runnable target or representative fixture.
- Use `terminal`, `read_file`, `search_files` and `patch` for investigation and repairs.
- In Aino desktop, use `desktop_preview` to open/read the selected page and `drive_preview` for elements, screenshots and actions when those tools are available.
- `browser_exec` or the project's existing Playwright tests provide a separate automated browser. They do not share the desktop browser's login state unless explicitly configured. Record which surface is tested.
- Do not assume a Codex Browser plugin, `agent.browser`, or Node REPL exists. If no browser is available, complete source/build checks and name the rendered checks that remain unverified.

## How to Run

1. State the flow: **entry → action → expected visible result**.
2. Start the repository's existing development or test command through `terminal`; keep the requested hostname exact.
3. Reproduce with realistic data, record the route, viewport and state, and capture the failure before editing.
4. Find the owning state or layout rule, repair it, and rerun the same flow and relevant sibling states.
5. Report the result with screenshot or state evidence and the precise limits of validation.

## Quick Reference

| Symptom | Evidence to collect | Likely inspection |
|---|---|---|
| Panel flashes or jumps | Before/during/after frame, scroll position | Mount keys, transitions, layout reads |
| Wrong or stale account data | Route, account identity, request sequence | Store reset, cache keys, subscriptions |
| Dropdown clipped | Open screenshot, scroll ancestors | Portal, stacking context, overflow |
| Loading feels slow | Request timing, first usable content | Sequential awaits, code splitting |
| Double submit or duplicate response | Input events, request IDs | Disabled state, idempotency, cleanup |
| Responsive overflow | Narrow viewport and long data | Min-width, flex shrink, intrinsic sizing |

## Procedure

### Establish a controlled reproduction
Use `search_files` and `read_file` to locate package scripts, routes, component ownership and tests. Preserve existing edits. Distinguish an application bug from a missing API, an expired test account or a backend failure. Use local fixtures when live side effects are unnecessary.

Record the page identity and first meaningful rendered screen. Confirm it is not blank and contains no framework error overlay. When browser logs are available, inspect relevant console errors and failed requests; do not label logs clean if the chosen tool cannot access them.

### Inspect behavior before changing styles
Use semantic element references returned by `drive_preview` rather than guessed selectors. Re-observe after navigation or stale-reference errors. Capture a fresh screenshot for coordinate actions and use its `tab_id` and `observation_id`. Observe the resulting URL, text, selected state, focus or action delta after each meaningful action.

Check the boundary states around the failure: initial/load, success, empty/error, retry, switching away/back and cancellation. For a layout problem, include a long title, many rows or a narrow panel. For a timing problem, use the project's supported network/latency test controls instead of arbitrary waits.

### Repair the cause
Trace data ownership, subscriptions, effect cleanup, stable keys and request ordering. Measure before adding memoization. For layout, inspect computed sizes and overflow containers, then fix the responsible component or token. Avoid blanket transitions, fixed heights that crop content, timeouts that hide races and app-wide selectors for a local defect.

Use existing behavioral test infrastructure for substantial state changes. Prove the test fails on the faulty behavior and passes with the fix. A screenshot-only issue may be checked with a focused visual comparison instead of a source-text assertion.

### Verify what users see
Rerun the original interaction after the repair, then a related path. Inspect desktop and a narrow viewport when applicable. Test keyboard focus and Escape for overlays, long content, scrolling and loading/error recovery. Compare a reference at its original dimensions where available. Keep findings in [references/qa-evidence.md](https://github.com/NousResearch/hermes-agent/blob/main/skills/software-development/frontend-testing-debugging/references/qa-evidence.md).

## Pitfalls

- Testing a different dev server, stale build or automated browser and assuming it represents the desktop application.
- Treating successful clicks as proof: observe the changed state and relevant persistent data.
- Resetting all user data to make a test pass or accepting a mock as live integration proof.
- Installing an unrelated browser runtime without first checking the repo's supported toolchain.
- Producing giant logs instead of the failing state, root cause and verified outcome.

## Verification

Confirm page identity, meaningful content, absence of a relevant framework overlay, target interaction and screenshot evidence. Report console health only if inspected. Include commands run, viewports, browser surface, fixes and remaining untested flows. Keep traces, temporary scripts and screenshots outside committed source unless requested.
