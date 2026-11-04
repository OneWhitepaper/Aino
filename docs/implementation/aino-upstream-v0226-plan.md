# Aino / Hermes v0.22.6 compatibility integration

**Goal:** Integrate the complete stable Hermes v0.22.6 release into Aino, preserving current Aino UI, account authority, text/image model routes and all existing features. Keep the work on `codex/aino-upstream-v0226`; do not publish a release or merge into main without the user's later instruction.

**Architecture:** Preserve upstream history with a two-parent merge from Aino `e86635e60e81c9365c4c0d7dd1a2270e9832c319` and Hermes `f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab`. Resolve conflicts by combining behavior at the existing seams. Adopt upstream runtime and protocol changes while translating presentation and interaction into Aino's current design system. Extend existing modules rather than create competing managers or tools.

**Spec:** User instruction in this conversation on 2026-11-03: protect existing UI; keep Aino account and image generation; retain new upstream capabilities and fixes; rebuild conflicting components and prompts in current Aino style; do not discard functionality without consent; complete compatibility work but wait for instructions before another release.

## Constraints and preserved contracts

- Isolated integration branch; current main, public 0.1.4 packages, update feed and production API are outside this change.
- Retain Aino visual tokens, Chinese user guidance, current sidebar/header, home/composer, model picker proportions, combined settings navigation, dialogs/toasts/error/approval cards and account layout.
- Retain file/browser/terminal/review tabs, editing/saving/preview/split actions and restoration. Summary belongs to its chat rather than the file workbench.
- Retain Agent Hub profile/chat identity, canonical bot conversations, group functionality and normal/Bot Mode switching.
- Retain Aino login, wallet/recharge, own text/image catalogs, per-session model selection, default-model restoration, original reasoning choices, image editing and automatic image quality.
- Keep existing upstream hosted-service options where currently enabled. New Web Access must preserve its capability and authentication boundary; integrate its UI without falsely presenting Nous authentication as an Aino account or enabling unauthenticated remote access.
- Preserve opt-in metrics and Aino destination, runtime restart serialization, profile isolation, prompt-cache invariants, approval behavior and pause/continue semantics.
- Browser migration preserves equivalent navigation, screenshots, uploads, real-profile and provider choices through upstream's new browser API.
- Keep release operations disabled. Any package used for verification is local and must not publish or advance an update source.
- Use PM-owned Python/tools/dependencies, root workspace installation, `scripts/run_tests.sh`, meaningful behavior tests and honest first-run versus rerun results.

## Task 1: Merge and inventory

- [x] Record clean Aino baseline and existing 0.1.4 acceptance evidence; verify exact upstream tag.
- [x] Merge `v0.22.6` using `git merge --no-ff --no-commit v0.22.6`.
- [x] Record all conflicts and assign disjoint source ownership to desktop, runtime and account/model lanes.
- [x] Keep a local integration ledger under `.superpowers/sdd/aino-upstream-v0226-plan/` and a final compatibility matrix in this document's validation sibling.

## Task 2: Preserve Aino account/model/runtime contracts

- [x] Resolve Python agent/config/gateway/tool and protocol conflicts while retaining Aino managed credentials, text/image selection/editing, telemetry destination and approval/session semantics.
- [x] Route Aino configuration through upstream ConfigBackend and migrate browser behavior to browser_exec/session without retaining dead tool references.
- [x] Regenerate the existing RPC/schema outputs after Python integration rather than hand-maintain divergent contracts.
- [x] Verify account/model/image/config/browser/profile/delegation/metrics seams with isolated homes and existing behavior suites.

## Task 3: Integrate desktop UI and new capabilities

- [x] Resolve sidebar, home/chat, settings, workbench, Agent Hub, account/model and locale conflicts against current Aino design and feature contracts.
- [x] Integrate upstream group actions, profile routing, terminal ownership/restoration, skill locks, cron stop/missed-run policy, reset-model, shared preferences, clarify forms and errors.
- [x] Present new Web Access through existing settings primitives with truthful service/authentication copy; preserve upstream access controls.
- [x] Audit automatically merged files as well as textual conflicts for old UI, duplicate navigation, removed account/model functionality or changed user-facing upstream branding.
- [x] Typecheck, build and run focused UI/Electron behavior suites after each coherent lane.

## Task 4: Verification and review

- [x] Prepare isolated PM test/runtime and locked JS workspaces for the merged graph; verify dependency locks and required source checks.
- [x] Run complete desktop UI and Electron suites, shared/TUI/web checks and broad Python regression through `scripts/run_tests.sh`.
- [x] Use isolated native desktop fixtures to verify chat/model/session scope, Agent Hub, files/review/terminal tabs, settings/account, image generation/editing, browser and restart. Visually inspect representative light/dark surfaces and new controls.
- [x] Independently review feature retention, UI consistency, config/browser migrations and final branch diff; fix findings and rerun affected checks.
- [x] Record actual executed results, skips, failures and reruns in `docs/implementation/aino-upstream-v0226-validation.md`.
- [x] Commit verified integration on its branch. Keep main and online release unchanged; report branch, evidence and any remaining limitations.
