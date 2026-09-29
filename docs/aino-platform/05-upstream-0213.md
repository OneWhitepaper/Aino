# Hermes 0.21.3 Integration

Validation date: 2026-09-18 (Asia/Shanghai).

## Source

| Item | Revision |
| --- | --- |
| Aino parent | `23301518fcf54ba74be9ebf5c0dfd560f3bf154a` |
| Upstream release | Hermes Agent `0.21.3`, tag `v2026.9.14` |
| Upstream parent | `345cd2b057a452236de401d3534b8502a7465e8d` |
| Previous upstream baseline | `2237be355906fbe6065ce1815711eee52b2d646e` (`0.21.1`) |
| Integration branch | `codex/aino-upstream-v0213` |
| Active Aino branch | `codex/aino-platform-identity-models-billing` |

This is a merge of the release tag, preserving upstream ancestry. It does not
track unreleased upstream `main`. Python, CLI and desktop package versions are
`0.21.3`.

## Aino Compatibility

- Retain Aino branding, application identity, `.aino` data isolation and the
  fetch-only upstream remote.
- Retain platform account authority in Electron, model lease ownership,
  per-account billing, and the explicitly enabled legacy development adapter.
- Retain the fixed Light/Dark/System palette, full-page Settings, persistent
  summary panel, terminal workspace, and draft/session navigation behavior.
- Reconcile upstream transport fanout with managed-session ownership: ordinary
  viewers can query model options; becoming a managed owner retires viewers;
  managed runtime tickets still require the exact owner.
- Extend the project-tree RPC contract with session identities emitted by the
  real backend, including identities beyond the preview limit. Regenerate the
  TypeScript and OpenRPC declarations.
- Update imports for upstream module moves, including reply metrics and native
  test fixtures.

Native validation exposed two additional account defects. Resource errors used
to increment the account revision, invalidating the model catalog and triggering
an unbounded reload loop. They now return to the resource caller without
publishing a new account state; transitions to offline or reauthentication still
publish, and generation/ownership guards remain intact. A real HTTP regression
was observed failing before the fix and passing after it.

The legacy development login previously queried `account.status` after receiving
a connection descriptor but before the WebSocket opened. It now waits for the
gateway to become ready. Platform authentication remains independent of gateway
availability. The gateway-routing regression was also verified before and after
the fix.

## Verification

The broad runs below were followed by focused reruns for every observed failure.
They are recorded separately rather than described as a fresh all-green full
suite. Counts across rows overlap and must not be added together.

| Check | Result |
| --- | --- |
| Python agent/CLI/plugins, 2,024 files | 22,916 passed, 16 failed, 237 skipped; one additional file timed out |
| Python state suite, 112 files | 1,249 passed, 55 skipped |
| Python updater/provider selection | 44 passed, 14 skipped |
| Full desktop renderer suite | 8,271 passed, 1 stale translation assertion failed |
| Full Electron suite | 2,341 passed, 6 skipped |
| Platform Electron regression after account fix | 103 passed |
| Account/model renderer regression after startup fix | 31 passed |
| Codex Responses and autostash final rerun | 93 passed |
| Other Python failure files, final rerun | 15 passed, 3 Windows-only cases skipped |
| Translation assertion, final rerun | 23 passed |
| Native platform account flow | 1 passed |
| Native chat flows, final rerun | 5 passed |
| TypeScript: renderer, Electron, E2E | Passed with `--noEmit` |
| Full desktop lint | 0 errors, 216 warnings; final changed-file lint also checked |
| Desktop production build | Passed |

Python failure closure:

- Install the pinned ACP test dependency for the manual-compression surface test.
- Use real SQLite connection subclasses for FD tracking, preserving production
  connection factory behavior instead of wrapping away its identity.
- Isolate updater tests from the host's launchd, dashboard cleanup, dependency
  installation and TCC anchor. Production updater logic is unchanged.
- Mark Windows-only cases for Windows CI rather than impersonating Windows on
  macOS.
- Isolate Codex stream tests from live model catalog discovery; the formerly
  timed-out file completes with 63 tests passing.

The renderer assertion now compares translation output with its locale catalog,
so legitimate upstream wording changes do not break the behavior contract.

Native tests use isolated temporary account/runtime data, the real Electron
bridge and Python backend, plus loopback platform and inference fixtures. The
account flow covers login while the backend is unavailable, authenticated
workspace startup, a second window, the account/wallet view, logout propagation
and fresh authentication after restart. Chat coverage includes sending, session
search/resume, composer layout and busy/queued controls.

Native fixture commands (from `apps/desktop`):

```sh
npm run build
node scripts/bundle-electron-main.mjs --dev
npx playwright test e2e/platform-account.spec.ts e2e/chat.spec.ts --workers=1 --reporter=list
```

The development bundle is required for isolated loopback platform origins and
the opt-in legacy adapter; packaged production guards remain enabled in the
production bundle. Restore a production build after native fixture testing.

The chat screenshot was generated and inspected; no visual comparison baseline
was available, so this does not claim a pixel-diff baseline pass. Stale native
assertions were updated to verify hidden unsent titles, restored conversation
titles and the actual voice-menu toggle while preserving search, layout and
queue/stop behavior checks.

Local evidence logs use `/private/tmp/aino-v0213-*.log`; native screenshots and
traces are under `apps/desktop/test-results/`. These are temporary local
artifacts, not repository fixtures. The merge also removes a conflict marker
already present in the upstream optional-skill catalog and whitespace reported
by `git diff --check`.

## Scope Limits

This update does not modify Aino-API or establish a new production API pairing.
Native coverage here uses test services, not live SMS, paid inference or payment
settlement. Signing, notarization, published installer distribution and production
deployment are outside this update. Earlier delivery receipts
remain historical evidence for their recorded revisions.

## Install And Update CI Follow-up

The inherited install matrix exposed executable discovery that still required
Hermes although the package produces Aino. Production discovery now accepts the
Aino artifact and legacy Hermes installs; the test drivers resolve artifacts from
the installed package metadata. Linux relaunch validation uses the actual updated
`hermes desktop` launch specification and its sandbox preparation.

An updater that changes the checkout must also evict the root `utils` module.
Otherwise its old module remains loaded while new gateway code imports
`base_url_origin`. The purge now includes `utils`, with a real reimport regression.

Completion verification starts before clicking Update and rejects stale results.
It retains completion evidence if the app consumes the result file, waits for
marker clearance, and checks the exact requested commit before relaunching.
Failed runs retain product logs as well as the test transcript and recording.

| Check | Revision And Result |
| --- | --- |
| Three-platform install/update matrix | `0f6f684577`, [run 35317189840](https://github.com/Ablankpaper/Aino/actions/runs/35317189840): all 25 executable routes passed; 18 first-attempt successes and 7 recovered historical failures |
| Linux install/update matrix | `c8500cc125`, [run 35311606869](https://github.com/Ablankpaper/Aino/actions/runs/35311606869): 6 first-attempt successes, 2 recovered historical failures |
| Windows install/update matrix | `2f05e1500f`, [run 35313398692](https://github.com/Ablankpaper/Aino/actions/runs/35313398692): 6 first-attempt successes, 3 recovered historical failures |
| Native Windows runtime handoff | `babfdb2103`, [run 35314271282](https://github.com/Ablankpaper/Aino/actions/runs/35314271282): all steps passed, including 4 new runtime handoff cases |
| Focused desktop launcher suite | 58 passed, 15 native-platform skips on macOS |
| Updater stale-module regression suites | 76 passed |
| Cron tracked-connection regressions | 26 passed through `scripts/run_tests.sh`; scoped Ruff passed |
| Update notification and startup regressions | 35 passed; Electron TypeScript and scoped ESLint passed |
| Host-isolated regression fixtures | 118 passed across the seven changed files; independent review found no concrete regression |
| Native process cleanup and adjacent file operations | 131 passed, 2 Windows-only skips on macOS; Ruff and Windows footgun scan passed |

The complete three-platform matrix includes eight Linux, nine Windows and eight
macOS routes. Each OS has six first-attempt successes; Linux and macOS each have
two recovered historical failures, and Windows has three. Both previously failing
macOS desktop-update routes now pass. Unavailable bootstrap and unsupported route
combinations remain skipped, not counted among those 25 successes.

A later complete local Python run covered 4,179 files: 49,359 passed, 11 failed,
571 skipped. Seven failure files depended on host proxy/DNS state, filesystem case
rules, available archive tools, GNU-only process inspection or a fake SDK's real
installation metadata. Their fixtures now isolate those inputs while preserving
the behavior assertions. The eighth failure exposed a real macOS process-exit
race: signaling an exited but unreaped process group can report `EPERM`. Cleanup
now reaps the child and suppresses that error only after the whole group is
confirmed absent. Native search also caches its new session's process-group ID
before a short-lived child can exit. Real macOS regressions cover both unreaped
and already-reaped children; permission denial while a group still exists remains
an error. The final full-suite receipt is recorded in PR #8.

The macOS diagnostic [run 35314445388](https://github.com/Ablankpaper/Aino/actions/runs/35314445388)
passed six routes and failed two app-update routes after their update transactions
had already succeeded. Both reopened Aino processes were sampled inside
`NSAlert runModal`. The manual-action completion notice used an unparented
`dialog.showMessageBox`; Electron's macOS implementation runs that notice in a
blocking native modal loop even through its Promise API. The failure notice used
the synchronous `showErrorBox` path.

Both notices now wait for the main window to become visible and use a parented
message box. Backend startup does not wait for acknowledgement. Behavior tests
cover visible and initially hidden windows, both result types, single delivery,
window closure and notification failure. The diagnostic screenshots also contain
a macOS local-network permission prompt; that observation alone does not identify
the application's modal stack as the system permission prompt.

The Linux Python CI also exposed five cron test failures caused by obsolete
SQLite test doubles. Tests now use real `TrackedConnection` subclasses and
replace the injected connection factory without duplicate arguments. They still
exercise real connection closure and a competing SQLite writer. Final full-suite
and post-fix install/update receipts are linked from
[PR #8](https://github.com/Ablankpaper/Aino/pull/8).

The two recovered Linux cases start at the exact `v2026.8.27` release commit
`5fc308a70719a83cccdbba4c0e39c23f5a8239d5`. Its already-running updater cannot
benefit from the new purge during that attempt. Recovery is allowed only when
the target checkout has landed and the log contains that specific missing-symbol
failure. The original transcript is preserved, a fresh updater runs once, and
all post-update assertions must pass. Reports call these known historical
failures, not first-attempt successes; failed recovery remains a failed job.

Windows desktop updates now prepare an isolated repair environment, exit the live
interpreter, synchronously repair the runtime from outside the live venv, and
only then run the normal updater. The existing transactional replacement and
SQLite checks remain authoritative. Native tests verify a real Win32 directory
sharing violation, release-before-cutover, SQLite rollback and PowerShell failure
propagation.

The three recovered Windows app-update cases also start at the exact August
release commit above. That release keeps its already-loaded PowerShell handoff
and retries from the venv it must replace. Recovery requires the expected old
module and runtime-refusal signatures plus the requested checkout already being
present. A separate invocation of the newly installed production handoff then
upgrades SQLite from 3.45.1 to 3.53.1. Each case verifies a fresh successful
receipt, cleared marker, target SHA, safe SQLite, working CLI and a rendered Aino
window. These are recovered historical failures, not first-attempt app updates;
the window smoke does not establish authenticated business-flow coverage.

This scope limit applies to every OS: install/update desktop smoke checks prove
that the updated application renders its window, not that authenticated business
flows work. The separately recorded native account/chat fixtures above provide
their own narrower business-flow evidence. The inherited general CI Desktop E2E
job is disabled upstream; its skipped status is not a desktop verification result.

Aino has no published signed bootstrap installer. Windows and macOS tests that
download a bootstrap are therefore unavailable until the repository variables
`INSTALL_E2E_SETUP_EXE_URL` and `INSTALL_E2E_DMG_URL` point to Aino installers.
Only the upstream repository defaults to the upstream Hermes download URLs.
Skipped bootstrap routes are disclosed in the matrix summary and are not Aino
installer coverage.

## Hermes 0.21.5 Integration — 2026-09-29

This update merges the stable upstream release into `codex/proactive-delegation`.
The September 18 receipts above remain historical results for their own revisions.

| Item | Revision |
| --- | --- |
| Saved Aino checkpoint | `7faaa158eb9acb710bb13d5fe418a1501cc196fe` |
| Upstream release | Hermes Agent `0.21.5`, annotated tag `v2026.9.24` |
| Upstream release commit | `f97608f178d1ffeca59860195ab7da295f7c8e5f` |
| Integration branch | `codex/proactive-delegation` |

The checkpoint preserves all pre-update Ultra changes. Work added during this
integration on configured child effort surviving fallback is deferred at the
user's request; its source copies, review and recoverable patch are kept in the
local `ultra-deferred-during-upstream-sync` evidence directory. That candidate
is excluded from this upstream merge. No paid model acceptance was started.

The integration preserves Aino identity, managed account/model/billing routing,
the fixed desktop palette and localized UI while adopting upstream plugin,
kanban and history-projection contracts. Python, CLI and Aino desktop versions
are `0.21.5`; the upstream desktop package has its own version history.

### September 29 Verification

Completed sweeps and targeted failure closure are recorded separately. Interrupted
runs are not complete-suite receipts, and overlapping counts must not be added
together. Logs use `aino-v0215-*`; durable copies are saved outside the checkout
in this task's `upstream-v0215-merge` evidence directory. These are native macOS
results, not Windows or Linux runtime acceptance.

| Check | September 29 result |
| --- | --- |
| Python full suite before test-only stabilization | 4,743 files; 49,697 passed, 1 failed, 749 skipped; 5 files passed only on automatic retry |
| Python final targeted closure, automatic retries disabled | 11 files; 59 passed, 0 failed, 1 Linux-only skip |
| Desktop full sweep | 1,399 files; 11,825 passed, 30 failed, 11 skipped |
| Desktop exact failed-file rerun | All 19 failed files rerun together: 139 passed, 0 failed |
| Desktop TypeScript and scoped ESLint | Passed; ESLint covers 31 files with 0 errors and 0 warnings |
| Shared, Web and TUI TypeScript checks | Passed |
| Web tests | 48 files, 352 passed |
| TUI tests | 169 passed files, 1 skipped file; 1,551 passed, 30 skipped |
| TUI Python-backed slash parity, prepared Python environment | 5 passed |
| Web and TUI production builds | Passed |
| Desktop production build | Passed; native helpers and production Electron bundles rebuilt |
| Isolated native mock chat | Five distinct chat cases passed across the initial run and search-case rerun |
| Native launch acceptance | Failed overall: product assertions passed, but fixture cleanup/app.close timed out after 90 seconds |
| Commentary timeline and projection regression | 45 frontend tests and 24 backend tests passed |
| Compatibility pointers and tracked path casing | Passed |

The Python sweep's sole hard failure waited only two seconds for a cold compute
host to import the server and emit hello. Twelve concurrent real-process probes
took 5.44–6.03 seconds, all with correct protocol replies and clean exit. The test
now uses the production supervisor's existing ten-second startup allowance;
later protocol-frame deadlines and assertions are unchanged. Its six-file
related rerun passed 33 tests with one Linux-only skip.

The five retry-only failures were investigated rather than counted as clean
first attempts. Test-only repairs synchronize compression worker cleanup before
the second stall, control the HTTP-date read clock, use an event handshake for
reset cleanup, wait for the real process descendant before timing its kill, and
disable detached Git maintenance while constructing a local-clone fixture. Git
Trace2 showed that the fixture's background repack deleted a loose object while
clone was copying it. No production behavior is changed by these repairs. The
compression file passed three consecutive runs with automatic retries disabled;
its exact second-stall assertions remain intact.

A 7,126-file Python/configuration hash snapshot confirms that only these six test
files changed after the full Python run; production files did not drift. The full
sweep is not rewritten as a zero-failure run. Similarly, desktop failure closure
does not claim a second full sweep on an immutable final tree.

The native launch cleanup timeout remains an open verification limitation. It was
not hidden by force-closing the fixture or weakening the acceptance result. This
merge does not expand into desktop shutdown lifecycle changes. No isolated
fixture processes remained after cleanup, and the daily desktop was not restarted.

The TUI broad run used the system Python for its optional registry probe; that
probe could not import `yaml`. Rerunning the five slash-parity checks with the
prepared project interpreter completed successfully rather than leaving that
environment-dependent gap unexamined.

The desktop history fixture now includes the backend's `display_commentary` and
`display_reasoning` projection. Raw Responses sidecars remain replay data: the
renderer does not bypass upstream commentary visibility or redaction policy.

The staged merge has no unresolved index entries or conflict-marker warnings.
The 431 end-of-file whitespace warnings reported relative to the Aino parent
are also present in that parent's diff to the upstream tag; this integration
does not broaden the change by reformatting those inherited files.
