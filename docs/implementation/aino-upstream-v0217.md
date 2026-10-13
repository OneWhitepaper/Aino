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

## Validation boundaries

No paid model requests, daily-profile migration, daily desktop restart,
publication, release signing/notarization, push or merge to main was performed.
Native Windows and Linux package execution remains unverified on this macOS
host. The Python receipt is a targeted integration selection, not the complete
repository suite. Dependency audit notices are not a completed security audit.
