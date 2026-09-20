# Multi-agent conversation implementation evidence

Status: in progress, 2026-09-20. The default new-chat entry remains unchanged and
`conversations.enabled` defaults to false. This document records specific checks;
it does not declare the complete A/B rollout accepted.

Implementation worktree: `.worktrees/multi-agent-conversations`, branch
`codex/multi-agent-conversations`. Reviewed backend integration is `40d71d5a53`;
reviewed desktop integration is `d2e8038f4c`. Further B1 work follows those commits.
The original checkout and its uncommitted work were preserved separately.

## Verified paths

| Path | Evidence |
| --- | --- |
| General → writer → reviewer → general → writer, attributed public history, stable project and Profile-owned sessions | Real Python backend, temporary shared/Profile databases, deterministic local HTTP model in `tests/tui_gateway/test_conversation_e2e.py` |
| Real terminal and model-triggered delegated work, asynchronous continuation ownership | Same backend suite; completion publication observed without racing the normal queue consumer |
| Exact read/write authority, stop/reconnect, immutable runtime model metadata | Scoped backend tests and independent reviews; readonly snapshot attachment cannot grant child mutation authority |
| Public/private conversation boundaries and existing Hosted groups | Integrated check: 237 tests in 21 files, no retries, `/tmp/aino-conversation-integrated-core.log` |
| Actual desktop five-round responder selection and reload | `multi-agent-conversation.spec.ts`, `/tmp/aino-conversation-electron-green2.log`: passed |
| Actual batch clarification and real terminal/delegation while next responder changes | Same desktop spec, `/tmp/aino-conversation-electron-tools3.log`: passed |
| Upload once, another expert receives original file content, long UTF-8 answer survives refresh intact | Same desktop spec, `/tmp/aino-conversation-electron-attachments2.log`: passed |
| Stop the running writer while retaining reviewer selection and the unsent reviewer draft | Same desktop spec, `/tmp/aino-conversation-electron-stop.log`: passed |
| Private command notice, selected-Profile skill expansion, reviewer receives public invocation only, explicit configuration refresh preserves draft/history | Same desktop spec, `/tmp/aino-conversation-electron-commands.log`: passed |
| All five desktop scenarios together after final command/composer integration | `/tmp/aino-conversation-electron-final-core.log`: **5 passed in 1.1 minutes** |
| Same-owner concurrent command admission/retry across two service instances | `/tmp/aino-command-tokens-race-green.log`: 33 tests across 6 files; notification sibling regression: 2 passed |
| Managed command/refresh and shared legacy/managed input controls | UI final focused regression: 40 tests across 9 files; full renderer/Electron/E2E typecheck passed |
| Actual child token/cost accounting remains on its original writer; prepared reviewer/default remain uncharged; prepared expert deletion refuses without fallback | Real HTTP pricing/metering and actual Profile deletion: 7 tests across 2 files, `/tmp/aino-a10-backend-acceptance-final.log` |
| Real terminal approval after next responder/draft changes | Sixth desktop scenario, `/tmp/aino-conversation-electron-approval.log`: passed; independent harness review approved |
| Full renderer, Electron and E2E type checking | Passed after command/shared-input integration; B1 final checks follow the project work |
| Desktop build | Production build passed; source-app E2E then uses the existing explicit development bundle/account adapter |

The later integrated check passed 239 tests across 22 files
(`/tmp/aino-conversation-integrated-final-core.log`), including immutable attachment
proofs and command resolution. An independent two-service interleaving review then
found a token replay race; the correction received the focused receipts above.
The final five-scenario Electron run used the corrected source.

Screenshot, test-result and log evidence was retained under
`.superpowers/sdd/2026-09-20-aino-multi-agent-conversations-core/evidence/final-core-electron/`.
The phase gate remains subject to the independent scoped reviews recorded in the ledger.

## Desktop test boundary

The tests launch real Electron and `hermes serve`. Only model inference is replaced
with a local deterministic HTTP service. HOME, HERMES_HOME and Electron user data
are temporary. Authentication uses the existing explicit development-account
adapter in a source build; this is not evidence of production platform login,
external provider behavior, external OAuth, packaging or notarization.

Run from `apps/desktop`:

```sh
npm run build
node scripts/bundle-electron-main.mjs --dev
npx playwright test e2e/multi-agent-conversation.spec.ts --workers=1
```

When rebuilding only the renderer, Vite clears `dist`; rerun the Electron bundler
and `node scripts/stage-native-deps.mjs` before launching. Individual test filters
are supported; shared setup is in `beforeAll`.

Observed failures were resolved or remain explicitly tracked: the production
bundle intentionally refused development auth; an initial catalog refresh showed
a false unavailable alert; fast completed children were absent from live-only
snapshots; and two test locators omitted actual accessible labels. The latter
were harness corrections, not production fixes. Final green receipts above use
the corrected real paths, without disabling the error-banner guard.

## Original UI restoration

The user rejected the simplified ordinary conversation UI on 2026-09-20 and
required reuse of existing components. The original Intro, composer surface,
project header, attachment list, model menu, tool entries, approvals, clarification
forms, markdown/user-message presentation and ProjectTree are now reused with
conversation-owned data/actions. Original legacy consumers use the same extracted
presentation; global legacy session actions are not substituted.

Actual Electron verification: **8 passed in 1.7 minutes**, all together against the
final source app (`/tmp/aino-ui-restoration-clean-final.log`). This includes five
responder turns/reload, live tools and child agents, shared attachments and 120KB
UTF-8 answers, Stop preserving another expert's draft, private commands and explicit
configuration refresh, real terminal approval, exact-source project browsing, and
original-home/sent/narrow layout plus actual model selection. The final model test
uses the existing search-and-Enter interaction; isolated mouse selection passed,
but pointer activation was intermittent in combined Electron automation and is not
claimed fully verified. Screenshots: `/tmp/aino-ui-restoration-evidence/`.

Original UI regression: 87 tests in 11 files passed. Additional shared tool/request
and managed UI regression groups passed (46 and 60 tests), as did full renderer,
Electron and E2E type checking. Two actual runtime issues exposed by multi-Profile
UI reads were fixed: unavailable processes cannot retain a shared execution lease,
and Stop interrupts the participant before waking its blocked clarification tool.
Their focused Python checks passed (87 and 6 tests); commit `1576555f15`.

This closes the scoped visual restoration and verified interaction correction,
not full ordinary-chat feature parity. Full voice/spoken replies/wake word,
reasoning/fast overrides, history editing/branch/reactions, slash discovery and
complete Sidebar→Projects routing remain release gaps. The ordinary default route
and `conversations.enabled: false` gate remain in place. B2–B5 expansion was paused
for this correction.

## Remaining acceptance work

- Close the explicitly listed ordinary-chat feature compatibility gaps before
  replacing the default entry. Scoped UI and eight combined desktop scenarios
  passed; they do not establish every release requirement.
- Complete projects, legacy adoption, archive/capacity controls, coordinated
  backup/restore and Agent Hub/navigation consolidation (B1–B4).
- Run final changed-scope checks, full Python regression and affected CI lanes;
  verify final combined artifacts, not merely earlier passing snapshots.
- Test platform-specific behavior on its real host. Current desktop evidence is
  macOS; Windows, Linux and unsupported remote execution are not claimed.
- Enable the new default workflow only after all release gates pass. No real user
  databases were migrated and no remote push or deployment was performed here.

The prior managed composer shared only input/send primitives with legacy ChatBar;
that was insufficient to preserve the approved ordinary-chat experience. The UI
restoration must use the original presentation and retain correctly scoped
commands, attachments, approvals and expert/model selection. Any unsupported
voice/queue/controller behavior must remain explicit rather than silently route
to an ambient legacy session.
