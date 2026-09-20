# Multi-agent conversation implementation and acceptance evidence

Status: implementation and local acceptance complete, 2026-09-20. Ordinary Home/New/workspace
routes select managed conversations only after a supported positive backend capability. At this
delivery the canonical `conversations.enabled` default is **true**, after G1–G4 independent
review and correction of the final concrete findings. Explicit opt-out, invalid configuration,
unsupported General execution and incompatible backend owners still refuse new managed work.
Missing section/key follows the canonical default without rewriting user YAML. Final full Python
regression exercised that enabled default; its single test synchronization failure was corrected
and independently verified as recorded below. There are no known open implementation blockers.
This is local source acceptance, not a deployment or a claim of remote CI success.

Implementation worktree: `.worktrees/multi-agent-conversations`, branch
`codex/multi-agent-conversations`. The original checkout and its unrelated work were preserved.
Early reviewed commits are historical checkpoints; the final receipts below identify the later
source and checks. No push, deployment or migration of real user databases was performed.

Final implementation commits, following the existing `0a27ddfc07` UI-restoration checkpoint:

- `e7eea54e7e`: exact-owner history, recovery, scoped runtime services and default rollout.
- `b2d0d6c3b8`: original desktop controls, unified history/project integration and final native coverage.
- `fc81e7da72`: event synchronization for the sole test race found in the final full Python run.

The following documentation commit records this acceptance and the completed A/B plans. All commits
are local on `codex/multi-agent-conversations`; the worktree is preserved for review.

## Implemented behavior and evidence

| Area | Verified behavior | Receipt |
| --- | --- | --- |
| Core ownership and continuity | General → writer → reviewer → general → writer, attributed public history, fixed project and Profile-owned private sessions; real terminal, delegated work and continuation | `tests/tui_gateway/test_conversation_e2e.py`; real temporary databases and deterministic HTTP model |
| Original UI reuse | Original Intro/composer, project header, attachments, model/options menus, tool entries, approval/clarification forms, markdown/user-message surfaces and ProjectTree | Final combined native acceptance: 17 passed, `/tmp/aino-final-clean-native17.log` |
| Exact active-turn authority | Next expert/draft selection does not retarget current writer, approvals, child agents, Stop or usage accounting | Native terminal/clarification/approval scenarios; real child billing checks in `/tmp/aino-a10-backend-acceptance-final.log` |
| Shared content | Upload once, later expert receives original bytes; full UTF-8 answers survive reload; owned content references reject foreign reads | Native attachment scenario and real attachment/content suites |
| Commands and frozen generations | Selected-Profile command discovery/private skill expansion, public invocation only for other experts, explicit configuration refresh preserves earlier history | Native commands scenario; command-token interleaving review and regression receipts |
| Rich input reuse | Original trigger, chip, undo and serialization helpers preserve surrounding prose, IME and external voice drafts. Unchanged draft writes preserve reference identity so long input cannot break later subscriptions | 66 targeted tests, independent IME/no-op reviews, actual chip/send and original long-input/model-selection acceptance |
| Reasoning/fast options | Original option UI uses validated prepared-generation display; actual runtime capability proof and completed historical model snapshots remain separate | RED native reasoning finding, backend correction, 14 targeted checks: `/tmp/aino-reasoning-draft-regression.log`, `/tmp/aino-reasoning-projection-regression.log`; independent `draft-options-independent-review.md` |
| Public history actions | Reaction, deliberate regenerate, branch and edited-branch automatic send use original controls; source events remain immutable; cancellation and command intent retain their ownership | `/tmp/aino-ui-history-native1.log`; independent history review and real RPC/HTTP tests |
| Branched model context | Copied same-author responses enter fresh child context; actual ACK suppresses subsequent reinjection; normal own-output coverage remains intact | Final backend review finding corrected; independent 14 checks in `/tmp/aino-backend-final-branch-independent.log` |
| Legacy adoption | Same local/remote legacy IDs remain distinct; exact-source adoption, old-link redirect, subsequent turn and snapshot verification | `conversation-history-migration.spec.ts`, `/tmp/aino-b4-native-history9.log` |
| Migration boundary | Live install-owner WS proof comes from existing authentication; only proven read-only native FDs are ignored; writes route to owning Profile backend | Independent migration review: 14 Python checks plus Linux-only skip on macOS; desktop routing checks |
| Metadata/capacity | First public input title, explicit rename, archive/reload retain complete history; admitted answers reserve capacity; partial migration cannot be renamed/archived | `/tmp/aino-ui-metadata-native1.log`; 65 focused checks and temporary-store pressure with 2,000 conversations, 1,000 events and 300KB response |
| Backup/restore | Coordinated install-wide snapshots, dependency/hash/receipt proofs, staged offline replacement and interrupted-restore rollback; fresh HOME can continue a real turn | `rollout-b3-root-recovery-report.md`; real three-Profile backup/restore and killed-process correction review |
| Voice ownership | Existing dictation/chained/live/wake engines use captured source/Profile; stale permission/playback callbacks cannot revive retired owners; response speech uses its public author independently of next expert | Scoped voice tests and independent UI review; native synthetic-capture boundary described below |
| Private live-voice context | Context is frozen in private execution input, digest-bound across retry/restart, budgeted using exact retained JSON bytes, absent from public branch/export | 34 targeted backend checks; unchanged independent Unicode accounting probe passed |
| Public export | Backend-generated paged JSON includes full referenced text and binary attachments; each page is owned and snapshot-bound; disabled/full storage remains exportable | Six backend checks plus independent review; original sidebar Export reuses existing download path and never saves a partial package |
| Home/workspace routing | Restoration/explicit legacy draft intent preserved; exact project source captured before discovery, carried through route handoff/retry; leaving the route prevents late create | Project races reproduced RED then fixed; 20 checks across 4 files, `/tmp/aino-project-capture-final.log`; three-project noEmit passed |
| Older backend owners | Missing/unknown capabilities, PID reuse and unverified writable holders refuse new work; exact current owners and proven read-only holders accepted | Real child-process compatibility matrix; old session visibility/pinning cannot expose private managed runtimes |

The original UI restoration, voice, reasoning/options, history actions, command discovery and
ordinary project/home routing are implemented and covered by the final combined native run.
The independent final backend review found and closed inherited branch-context coverage; it identified
no other concrete blocker. Its findings were followed by the whole-suite and native checks below.

## Final validation

The first broad Python run completed with **49,445 passed, 56 failed, 590 skipped**, plus two files
that passed only on retry (`/tmp/aino-full-rollout-regression1.log`). The first broad desktop run
reported **1,165 passing files, 9 failing files, 2 skipped files** and **10,683 passing tests, 7 failing
tests, 8 skipped tests** (`/tmp/aino-desktop-full-regression1.log`). These are discovery runs, not
release-green receipts. Those findings were corrected. Final backend consolidation with retries disabled passed **4,015 tests
across 321 files**, including all feature changes, original failed/flaky files and the relevant
Profile/group/project/delegation/backup suites (`/tmp/aino-backend-final-consolidation.log` and
`/tmp/aino-backend-final-supplement.log`). Final desktop Vitest on the formatted source including the
rich-input/IME correction passed **1,176 files / 10,754 tests**, with 2 files / 6 tests skipped and
no failures or retries (`npm run test -- --maxWorkers=4`, `/tmp/aino-desktop-full-final.log`).
This desktop whole-suite receipt precedes the final no-op draft reducer correction. That correction
passed 12 focused producer tests and 13 independent tests, then all 17 native scenarios on the final
build. The whole desktop suite was not rerun after that correction.

The final default-enabled Python run used
`HERMES_TEST_FILE_RETRIES=0 scripts/run_tests.sh -j 20`: **4,231 files, 49,509 passed, 1 failed,
590 skipped**, 800.9 seconds, exit 1 (`/tmp/aino-python-final-default-on-full.log`). The sole failure
was `test_eviction_skips_kernels_with_a_running_cell` in `tests/tools/test_code_kernel_remote.py`:
the test busy-spun over a dictionary while the worker inserted an entry. Replacing that polling
with an event at the actual running-cell boundary preserved the busy-owner and no-kill assertions;
`finally` releases and joins the worker. No production kernel code changed. With retries disabled,
the corrected remote and adjacent local kernel files passed **35 tests**
(`/tmp/aino-kernel-adjacent-final.log`), and independent review reran the remote file: **13 passed**
(`/tmp/aino-kernel-sync-independent.log`). All failures from the full run are thus accounted for
and corrected, but that original full-run result remains recorded as one failure; no second full
Python run is claimed.

The broad run exposed maintenance regressions that have focused corrections: duplicated identity
reads, ordinary Profile initialization touching the installation root, async token accounting waiting
on its own queue, and unnecessary read-path work before normal retries. Managed token writes still
acquire the snapshot permit; the identity read no longer drains the writer's own queue. Ordinary
no-shared/no-restore state stays isolated. See `full-regression-maintenance-fixes.md` and
`b5-maintenance-independent-review.md` in the implementation ledger.

The final default-enabled build passed **all 17 native desktop scenarios** in 3.9 minutes
(`/tmp/aino-final-clean-native17.log`). This includes the initial ordinary home and keyboard New,
five responder turns, real tools/delegation/approval, attachments and full long answers, Stop,
project sources, exact-source legacy adoption, original responsive UI/model selection, branch/edit/
regenerate/reactions, rename/archive/export, synthetic dictation, reasoning metadata, inline skill
chips/undo, unsupported General fallback and missing old APIs with a real legacy model request.
The main fixture deliberately omits the feature setting, exercising the canonical enabled default.

The earlier confirmation symptom was traced to unchanged draft writes causing React's maximum
update-depth error during long input, not a failed model RPC. The exact no-op reducer fix was
reproduced RED, passed independent review, restored the original native reproduction, and is in
this final combined build. Temporary diagnostics were removed. Each native scenario now rejects
renderer errors in addition to the existing error-banner guard.

Additional final checks:

| Check | Result and receipt |
| --- | --- |
| Desktop build and development Electron bundle | Passed; `/tmp/aino-final-clean-build.log`, used for the final 17 native scenarios |
| Desktop renderer, Electron and E2E types | `npm run typecheck` passed with noEmit; `/tmp/aino-product-final-types.log` |
| Desktop ESLint | Exit 0, zero errors, 322 warnings; `/tmp/aino-product-final-lint.log` |
| Shared package types/lint | Passed; one generated unused-disable warning; `/tmp/aino-shared-final-check.log` |
| TUI and dashboard types | noEmit passed; `/tmp/aino-tui-final-types.log`, `/tmp/aino-web-final-types.log` |
| Python style and compatibility pointers | Ruff passed and no in-tree use of 2,091 compatibility pointers; `/tmp/aino-release-ruff.log`, `/tmp/aino-release-compat.log` |
| Website | Default/en production build passed; 41 Python tests passed; ASCII guard checked 465 files with zero errors; `/tmp/aino-site-release-build.log`, `/tmp/aino-site-tests-final.log`, `/tmp/aino-site-diagrams-final.log` |
| Default and environment negotiation | 13 tests passed, one Linux-only skip; `/tmp/aino-default-enabled-final.log`; also included in the final Python run |
| Diff and scope | `git diff --check` clean; no lockfile/dependency/workflow changes, real secrets, user state, generated site artifacts or automation additions |

## Native test boundary

Desktop tests launch real Electron and `hermes serve` with temporary HOME, HERMES_HOME and Electron
user data. Model inference uses a deterministic local HTTP service. Authentication uses the existing
explicit development-account adapter in a source build. Voice acceptance uses Chromium synthetic
capture and a temporary command STT provider. These tests do not verify production platform login,
external OAuth/provider behavior, physical microphones, external voice services, packaging or
notarization. Current native evidence is macOS; Windows/Linux behavior belongs on its actual host.
Unsupported remote execution environments are not claimed supported.

From `apps/desktop`, the existing run path is:

```sh
npm run build
node scripts/bundle-electron-main.mjs --dev
node scripts/stage-native-deps.mjs
npx playwright test e2e/multi-agent-conversation.spec.ts e2e/conversation-history-migration.spec.ts --workers=1
```

Vite clears `dist`; rebuild the Electron bundle and stage native dependencies after renderer-only
rebuilds. Final screenshots, logs and review artifacts are retained in
`.superpowers/sdd/2026-09-20-aino-multi-agent-conversations-core/` and the referenced temporary logs.
The 20 final log receipts are also copied under `evidence/final-default-on/receipts/` in that ledger,
with a SHA-256 manifest; screenshots and traces are in the neighboring `test-results/` and `ui/`.

## Coverage limits and delivery

The CI classifier selects Python, frontend, website, supply-chain scan, Docker and Nix lanes.
The corresponding available local checks above passed after the documented test correction.
The Docker daemon is unavailable and Nix is not installed, so those two build lanes were not run.
Windows/Linux host-specific tests were skipped on macOS and require their actual runners.
The local supply-pattern check found no new `.pth`, base64-exec or obfuscated-subprocess patterns;
it is not a remote CI attestation. No remote CI run was started for this local delivery.

The missing-RPC native scenario simulates an older protocol over the real backend and proves an
ordinary legacy draft still sends a real model request. It does not run an old binary or promise
that managed history can be reopened after arbitrary backend downgrade.

A1–A10 and B1–B5 are complete within these local acceptance boundaries. Original ordinary UI
components remain the presentation layer; expert choice changes the next responder, projects
retain the work context, and each expert keeps its private Profile runtime. Automatic delegation,
canonical Bot Chat and Agent Hub remain covered by the relevant regression suites. Final independent
reviews closed the branch-context, project-capture, rich-input/IME, unchanged-draft, compatibility
and test-synchronization findings. The implementation branch and worktree are retained for integration.
