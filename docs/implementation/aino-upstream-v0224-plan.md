# Aino v0.22.4 Compatibility Integration

> Implementation plan for the v0.22.4 sync, executed on `codex/aino-upstream-v0224` from current Aino main.

**Goal:** Integrate the complete stable Hermes v0.22.4 release window into Aino while preserving upstream behavior and adapting conflicting desktop presentation and operations to established Aino contracts.

**Architecture:** Merge the exact upstream release commit to retain history, then resolve conflicts at existing Hermes/Aino seams. Keep Aino's product authority and compact neutral desktop presentation while integrating upstream backend, CLI, plugin, catalog, dependency, CI, and desktop behavior.

**Tech Stack:** Git merge history, Python/Hermes PM, Electron/React/TypeScript, canonical Python and workspace test runners, GitHub Actions native platform checks.

**Spec:** User request in the current task: synchronize stable Hermes v0.22.4 into Aino, retain conflicted upstream updates, and adapt UI conflicts to Aino's current visual style and page operations.

## Global Constraints

- Base: Aino main `3369bd314f0806a378cadc790c5adf14dba5a304`.
- Upstream: stable Hermes v0.22.4 `4d04303818b61bf3aa09278af48356315515965b`.
- Preserve upstream merge history and upstream functionality; do not drop changes merely to reduce conflicts.
- Preserve Aino identity, model/account/billing authority, managed context limits, project-folder behavior, Summary panel, compact response presentation, and collaboration on existing Hermes delegation.
- Resolve desktop visual conflicts using Aino's current palette, spacing, and interaction patterns without removing the upstream operation itself.
- Reuse existing code and extension points; do not add a parallel manager, API, scheduler, or redundant UI mechanism.
- Use `scripts/run_tests.sh`, `scripts/check`, existing desktop workspace checks, and hosted native CI; never fake host-specific behavior.
- Do not change user profiles, make paid model calls, publish installers, or modify release/download feeds.

## Tasks

### Task 1: Import the exact release and map conflicts

- Merge the fetched v0.22.4 commit into this branch without squashing or cherry-picking away its history.
- Record every conflicted path; resolve by integrating both sides and document the Aino-specific choices.
- Treat new v0.22.3-window capabilities as in-scope alongside the v0.22.4 patch notes.

### Task 2: Reconcile the desktop and product contracts

- Inspect all conflicts in `apps/desktop/`, shared renderer contracts, and locales.
- Preserve upstream composer, queued-message, subagent picker, plugin/OAuth, and approval behavior while rendering it in Aino's established UI.
- Keep project creation/opening, Summary, account/model/billing, context limits, profile ownership, and session routing behavior intact.
- Add or adapt behavior tests at the existing feature seams; update all required locales.

### Task 3: Reconcile backend, catalog, dependencies, and CI

- Integrate remaining upstream changes across agent, CLI, gateway, tools, TUI, website, scripts, and tests.
- Regenerate dependency locks only through Hermes PM and preserve Aino platform pins and build paths.
- Advance exact reviewed-upstream references in contributor attribution, code-health, and plugin-catalog admission checks from v0.22.2 to v0.22.4; retain their security and anti-regression guarantees.
- Update catalog validation fixtures and compatibility documentation without replacing Aino-specific policy.

### Task 4: Validate and finish integration

- Run focused regressions after each conflict area, then canonical Python tests, static checks, desktop/Electron/JS checks, and builds.
- Compare inherited upstream findings separately from Aino integration regressions; fix new regressions rather than blanket-exempting them.
- Push the completed branch for hosted CI and require macOS, Windows, Linux, required checks, and independent workflow results before integration.
- Record exact revision and test/CI evidence in the validation report. Do not describe a source merge as an installer publication.
