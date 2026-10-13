# Aino upstream v0.21.7 integration

## Source and scope

- Stable upstream tag: `v0.21.7`, commit `71d34bad1045610252eda02ee79549436896e784`.
- Upstream release published at `2026-10-12T05:53:41Z`; not a prerelease or draft.
- Aino starting commit: `e9e8cfda8268ce3449f5980d9e0b78ea8f690a5b`.
- Integration branch: `codex/aino-upstream-v0217`.
- Integrate upstream history with a merge, retaining upstream authorship.

The update preserves Aino account authority, managed-model leases and billing,
the `.aino` data root, compact desktop presentation, folder-based projects, and
Hermes-based agent delegation. No separate collaboration engine is introduced.
The configured context limit continues through desktop display, runtime, child
agents, and compression; the managed-model tests exercise binding and renewal
with distinct limits and isolated profiles.

## Compatibility work

- Reuse upstream's extracted runtime modules, durable message identity, reasoning
  replay, cache handling, and generated gateway contracts.
- Build an isolated Python 3.14 environment through upstream PM; migrate Aino's
  remaining direct PyYAML imports to `hermes_yaml`. Do not mutate the daily
  checkout's environment.
- Preserve Aino branding while adopting the dynamic language registry and
  extracted locale modules. Localization ratchet additions come only from
  missing keys in the pre-upgrade Aino catalog; new upstream Simplified Chinese
  keys are translated. Regenerate `locales/_keys.desktop.json`.
- Preserve asynchronous model-selection failure rollback and project context;
  adapt call sites to upstream's revised renderer contracts.
- Keep Aino settings-footer commit details alongside upstream release-channel
  labels, without duplicating the update hint.
- Fix macOS remote-process ownership inspection for paths containing spaces by
  extending the existing probe's argv reader; keep the ownership matcher.
- Keep Aino package identity and signing configuration; do not inherit Nous's
  signing identity.
- Exclude only immutable historical Ultra source fixtures from strict Ruff;
  preserve their bytes and manifest hashes. Apply the upstream rules elsewhere.

## Validation record

Source conflicts are resolved. The integration remains on the upgrade branch;
it is **not accepted for main** because the code-health ratchet still fails.
Passing functional tests do not override that gate.

| Check | Result |
| --- | --- |
| Selected Python 3.14 runtime/Aino integration, canonical runner | 89 files; 2,571 passed, 81 skipped, 0 failures or flakes |
| Complete renderer UI suite | 1,361 files; 11,582 passed |
| Complete Electron unit suite | 382 passed files, 8 skipped files; 3,751 passed, 33 skipped tests |
| Native macOS ownership and real codesign fixtures | 100 passed, 1 skipped |
| Bootstrap Rust tests | 115 passed, 2 ignored |
| Desktop TypeScript checks (renderer, Electron, E2E, builder) | Passed |
| Desktop ESLint | Passed; existing warnings remain |
| Production desktop build | Passed; production bundle rebuilt after native fixtures |
| Eleven static checks, excluding code health | Passed |
| Follow-up UI / Electron regression after import/lint cleanup | 45 / 42 passed |
| Python duplicate-definition cleanup | 82 passed, 6 skipped |
| Native account login, shared-window authority and sign-out/restart | Passed with local mock platform service and session-only credentials |
| Native folder/project, tool scope and restart suite | 7 passed in 47.6s, local mock inference |
| Immutable Ultra fixtures | All 13 files byte-equal the Aino base; all 10 manifest entries match |
| Code-health ratchet against the Aino base | **Failed: 1,248 blocking findings** |

The complete UI and Electron suites initially failed. Repairs were followed by
complete successful reruns; the failed attempts are not counted as passes.
Native fixture repairs align the tests with Aino's existing phone login, project
dialog, Workspaces page, Session resources label and collapsed Details section.
Creating a new chat must wait for a new surface identity, rather than an empty
composer that was already empty on the sent chat. A files pane may remain a
collapsed rail after a window-size change; the test restores it via its Files tab. These assertions continue
to check real backend persistence and real Electron/native operations with mock
inference, rather than replacing production behavior with mocks.

The account fixture disables persistent login to avoid requiring interactive
macOS Keychain access. It verifies shared-window sign-in/out and restart signed
out; it does not claim persistent-login Keychain acceptance. Production trust
boundaries are unchanged. Native fixtures use the existing development Electron
bundle because the production bundle deliberately rejects local development
account configuration.

One earlier native run failed creating a session with "Timed out connecting to
Hermes backend after 5000ms". This did not recur in the final run, but its cause
is not established and it is **not claimed fixed**. No connection timeout was
increased and no banner guard was disabled. The final fixture preserves backend
logs before removing its isolated home; the failed run
`aino-v0217-project-e2e-rail.log` remains in the receipts.

### Open code-health gate

Both measurements use the current checker and the same Aino starting commit
`e9e8cfda8268ce3449f5980d9e0b78ea8f690a5b` as the baseline:

- Merged working tree: **1,248** blocking findings.
- Untouched upstream `v0.21.7`: **1,234** blocking findings.
- Matching `(path, rule, scope)` identities: **1,212**.
- Identities present only in the merged result: **36**. This comparison does not
  prove all shared findings are identical or harmless, nor that all 36 are new
  runtime defects. The full JSON retains details for inspection.

Findings include exception-handling patterns, duplicate/undefined names, and
file/function complexity limits. Concrete duplicate definitions/imports found
while integrating were repaired. The remaining gate must not be described as
all inherited, only a formatting issue, or passing. No enforcement switch,
threshold, CI job, or baseline was relaxed. No broad unrelated refactor was
introduced to make this source import green.

Reproduce, with the base fixed even after making the merge commit:

```sh
.venv/bin/python -m scripts.code_health \
  --base e9e8cfda8268ce3449f5980d9e0b78ea8f690a5b --json
.venv/bin/python -m scripts.code_health \
  --base e9e8cfda8268ce3449f5980d9e0b78ea8f690a5b --head v0.21.7 --json
```

The source merge can be saved on its branch for review, but main/PR acceptance
requires resolving or explicitly reviewing the remaining health findings under
the repository's existing policy. A successful push that does not execute the
PR-only health job would not settle this gate.

### Reproduction and receipts

Python uses only the canonical runner with the isolated runtime:

```sh
HERMES_PYTHON="$PWD/.venv/bin/python" scripts/run_tests.sh <selected-paths>
```

From `apps/desktop`, the full functional receipts are `npm run test:ui`,
`npm run test:desktop:platforms`, `npm run typecheck`, `npm run lint`, and
`npm run build`. Native fixtures use the existing development bundle and
Playwright with one worker, isolated homes and local mock inference.

Local receipts, including the exact Python selection and code-health JSONs:
`/Users/zizimutou/.codex/visualizations/2026/10/13/aino-upstream-v0217/`.

## Pre-merge review follow-up (2026-10-13)

The merge checkpoint `c2aa9342ba` was pushed to
`codex/aino-upstream-v0217`; draft PR #10 records the open blockers. It was not
merged to main and auto-merge was not enabled.

Read-only review found two real publisher integration errors: the macOS feed
validator and Windows universal-bundle publisher still required Hermes artifact
names, while Aino's packager generated Aino names. Both now reuse the existing
product identity resolver. The resolver accepts the existing light variant and
resolves its module relative to this source checkout, so publication from an
artifact staging directory also works. Windows assembly-version validation is
unchanged. A related download-table filter now includes current packager names,
while retaining historical Hermes record support. Its default repository and
page branding come from the existing desktop brand configuration.

The original native-feed test with actual packager names reproduced the failure;
a generated-name download-table test also failed before the fix. The Windows
workflow-body regression executes the real filename/version selection boundary
against a temporary staged artifact, intercepting only external publication; it
rejects a mismatched assembly version. Real loopback publication tests remain.
A second read-only review found no new significant defect in these scoped fixes.

The first remote CI run (`38343789129`) was cancelled at its one-minute detect
job limit. `gh api --paginate` was walking nearly ten thousand upstream commits,
although compare file paths exist only on the first page. The shared action now
reads that page once; a saturated 300-file response selects all lanes because
GitHub's file list may be incomplete. Checkout and bounded retries have five
minutes. Dynamic-matrix replay now executes the real generated test plan and
asserts that every owned E2E file is selected exactly once. The retired Windows
launcher test reference was removed, current platform markers restored, and
Aino's desktop-identity dependency added to the existing routing lists.

The first remote Termux/TUI run failed in the shared JS fixture suite: its
synthetic desktop omitted `brand.json` and the captcha preload source, and its
smoke-home assertion expected the upstream brand. The fixture now supplies both
real build inputs and derives the home expectation from the shared brand.
The local JS check must use the prepared Python environment; an initial run
without that environment also exposed host Python/temp-path differences.

Follow-up receipts (these overlap; do not sum as unique tests):

| Check | Result |
| --- | --- |
| Publisher identity, feed transport, channels, variant builds | 47 passed |
| Download tables, stable transaction and artifact publication | 80 passed |
| CI routing and executable workflow replay | 242 passed, 35 platform skips |
| Root JS suite, typecheck and ESLint | 242 passed, 3 skips; checks passed |
| Follow-up patch code health versus merge checkpoint | No new blocking findings |

These fixes do **not** clear the original code-health gate against the pre-upgrade
Aino base, and do not establish a cause for the intermittent desktop connection
timeout. Subsequent remote CI is required; cancelled, skipped or still-running
jobs are not passes. No remote publication has been executed by this work.

## Validation boundaries

No paid model requests, daily-profile migration, daily desktop restart,
publication, release signing/notarization, or merge to main was performed.
The upgrade branch and reviewed follow-up fixes are pushed for CI.
Native Windows and Linux package execution remains unverified on this macOS
host. The Python receipt is a targeted integration selection, not the complete
repository suite. Dependency audit notices are not a completed security audit.


## CI repair checkpoint (2026-10-13, after `224d06755c`)

This checkpoint is **not approved for main**. The complete remote suite must
pass on the new commit; Windows and Nix changes are not locally executable.

### Functional fixes and local receipts

- Repaired-history rewind: explicitly refuse a comparable but divergent replay
  instead of falling through to the upstream carrier-text resolver. Existing
  legacy/repeated-rewind cases remain supported (702 focused gateway tests pass).
- Restored the Aino ESRCH-safe test-process guard at its new upstream fixture
  location. A positive-PID POSIX probe may report ESRCH but never sends a real
  signal to an unrelated live process.
- Aligned bootstrap, metrics, turn-ID, heartbeat-admission and notification
  fixtures with the merged APIs; managed cancellation uses real loopback model
  metadata and the existing ready event. Aino wire coverage uses a real managed
  credential with an explicit inert endpoint.
- Windows suspension checks read the kernel suspend count, rather than a racy
  scheduler snapshot. Pipe failures now preserve child stacks. Reduced Windows
  test workers from 16 to 4 after cold PowerShell/CIM stalls and retry evidence;
  timeouts and behavior assertions remain unchanged.
- Removed the test for the deleted in-place runtime rebuild API. Existing PM
  tests retain real publication-failure rollback and Windows held-entry coverage.
- Smoke environments remove the whole indexed Git override group, preserving
  valid global redirects; installer repository overrides again reach the real
  install path. Nix includes X11 build headers and the desktop identity import.
- Existing icon generation now consumes the retained Aino raster for desktop
  containers; no new artwork. Two generations produced byte-identical results.
- Prompt surface regeneration reflects existing Aino branding/delegation. Its
  macOS renderer initializes native imports before platform pinning and scrubs
  both temporary-directory aliases. No new model instructions added here.

Combined canonical runner: **20 files, 375 passed, 0 failed, 13 host skips**.
This includes the 42 code-health CLI tests and 13 icon tests. Earlier broader
rewind receipt: 702 passed. Ruff passes. No paid model runs or daily-app restart.

### Reviewed supply-chain matches

Five matches in four files are source-quoting transports or inert fixtures:
`hermes_cli/_launchers.py` encodes its visible generated launcher source;
`tools/file_operations.py` encodes visible Python snippets for cross-shell
quoting; the Python gateway fixture uses that launcher source; the two JS
fixtures encode the literal `x`. No downloaded hidden payload is involved.
The scanner exempts only the four reviewed Git blob hashes. Any byte change
restores scanning of the entire file. The current scanner replay exits 0 with
`found=false`; the production transports remain unchanged.

### Contributor attribution

49 email-to-login mappings were verified through GitHub's commit-author data.
Generic `you@example.com` was deliberately not globally mapped because multiple
Git author names use it. Historical unresolvable authors from the fixed upstream
release retain their original Git names, rather than invented GitHub logins.
Only authors whose new commits are entirely in that release use this treatment;
new Aino commits from the same email still require a mapping. CI retains their
names in its log. The full Git history and existing release fallback are intact.

### User-approved upstream health classification

The user explicitly approved separating inherited stable-upstream findings from
Aino integration regressions. The reference is fixed to
`71d34bad1045610252eda02ee79549436896e784` (v0.21.7), must be a head ancestor, and
expires once the base branch contains it. The existing occurrence-aware comparer
runs against both the Aino base and the upstream revision. All original findings
remain in the JSON artifact. A new occurrence, copy or worsened metric stays
blocking; tests exercise each case and expiration after merge. No targets or
rule severities changed.

Latest local classification still has **65 blocking structural findings**
(34 complexity, 24 file-length, 7 function-length). These cannot be waived as
unchanged upstream debt. The complete report is preserved in the local evidence
folder as `health-classified-before-cleanup.json`. Structural cleanup and native
CI verification remain open; this checkpoint must not be merged yet.


### Structural cleanup and image freshness follow-up

The first repair checkpoint was pushed as `7d62abb9b0`; remote verification is
still running. Its image freshness lane exposed a platform mismatch: pinned
Pillow/resvg versions match, but compressed PNG/container byte sizes differ
between macOS and Linux. The existing `--check` now compares every rendered
pixel, native ICO/ICNS frame, and color-management field; SVG/JSON retain exact
bytes. CI checks the committed files directly without overwriting them first.
A one-pixel change and a missing native size are both detected; different PNG
compression alone is accepted. Cross-platform confirmation remains pending CI.

The retained Aino raster is about 636 KiB even after lossless optimization.
Eight exact generated icon paths were added to the existing blob-size policy's
shipping-asset allowlist (the same mechanism already used by the DMG icon).
Their repeated PNG content shares one Git blob; no global limit was raised.

Structural cleanup reuses existing topical files: home/SOUL tests, Kanban init
tests, memory and Codex continuation tests, and gateway fallback tests were
moved without deleting coverage. Model pill rendering, pane registration,
service-tier selection, version labels and model-state snapshots were split
into named functions. Existing managed-model equality is now shared from its
own module. No wire or user-visible semantics were intentionally changed.

Receipts: 158 configuration/Kanban tests (6 host skips); 356 agent tests;
673 gateway tests; 125 UI tests across model menus, state propagation, model
switching and pane scope. Renderer TypeScript and targeted ESLint pass.
Scope measurement eliminated 10 of the 65 structural blockers, before the
additional gateway test extraction. Remaining unchanged scopes still require
cleanup; do not infer a passing full health gate or merge approval.

### Native handoff synchronization and renderer provenance (204d708924 follow-up)

The Windows marker-lock probe now waits at the existing fixture help command,
then observes the suspended child's completed job assignment before killing its
owner. It no longer races marker claim/publication or waits on a slow CIM scan.
The R6 timestamp probe keeps a real byte-range lock until the production release
wait is observed, instead of assuming startup finishes before a 25-second timer.
The stale Windows workflow test path now names the retained PM runtime-replacement
and desktop runtime-resolution coverage. Local classification: 160 passed; 15
Windows tests skipped on macOS. Native CI remains authoritative for those probes.

Icon CI diagnostic artifact from run 38380028041 was compared against the local
files using the same exact pixel/frame/profile checker: after restoring upstream's
installer `art-light.png`, all 99 targets match. The Mac ARM64 render differed at
five alpha pixels (bbox 524,1014–526,1023, max delta 16); RGB was unchanged. A Mac
x86_64 render reproduced upstream's light portrait exactly, but differs from Linux
on the dark/mono layers. Thus OS/CPU renderer build—not PNG compression alone—is
part of reproducibility. The canonical reference remains Linux x86_64, matching
CI; documentation no longer promises cross-platform pixel determinism. No pixel
tolerance, freshness exemption, or renderer dependency change was introduced.

### Structural follow-up verification

The full dual-base health report now has zero blocking findings (1,300 retained
records, including inherited/advisory results). Runtime extraction reuses existing
socket, auxiliary-wire, stream-emitter, summary, metadata and config-validation
modules; focused image-recovery and replay-row siblings hold previously inline
behavior. The shared Aino agent paths retain their original await/call ordering.
Desktop splits session hooks/test harnesses, locale bundles, gateway types, pane
share memory and UI subcomponents. Electron main delegates existing preview,
file-watch and image-persistence behavior to topical modules and keeps the
existing filesystem hardening path. No policy thresholds or allow comments changed.

Canonical Python receipts: 168 files/2,496 passed/74 skipped, plus 15 files/481
passed/6 skipped and 9 files/553 passed/6 skipped (overlapping selections, not a
sum of unique tests). Desktop receipts: 72 hook files/936 passed; 69 locale/pane/
gateway files/389 passed; 26 renderer files/353 passed; lifecycle 98 passed and
1 platform skip; preview extraction 88 passed. New preview contracts exercise
real file reads, native watching, missing-file classification, bounded preview
versus full plugin reads, and persisted cap round trips. Full CI on the final
commit is still required before merging.
