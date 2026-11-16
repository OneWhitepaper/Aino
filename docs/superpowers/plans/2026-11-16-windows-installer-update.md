# Windows installer and online update implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the approved installation/update scope without publishing packages or production feeds.

**Goal:** Provide installable Windows candidates and exercise the existing App Installer update lifecycle while preserving ZIP users' state.

**Architecture:** Retain the existing MSIX/App Installer owner, build stamp and graceful handoff. Generate candidates in isolated standard hosted CI with a disposable test certificate; private jobs retain inputs and explicit public jobs retain curated receipts only; never confuse test signing with production release acceptance. Reuse the canonical `%APPDATA%/Aino` data root rather than copying account state into a second root.

**Tech Stack:** Electron 44, electron-builder, Windows SDK, PowerShell, existing Python bundle/release scripts and Vitest.

**Spec:** The user's approved five-step installation/update/data-preservation/Windows-acceptance request in this conversation. New installers and stable feeds must remain unpublished.

## Constraints and rulings

- Original UI worktrees remain untouched. Continuing Windows-only work uses `codex/windows-native-acceptance` in `aino-windows-native-acceptance/Aino`, based on `b121c42af7`; the other chat's `0334597e83` is excluded and preserved.
- Keep Copilot key registration, native aliases, profiles, account isolation and local data.
- User confirmed no production signing resources and requested test-signing acceptance first. A disposable CI certificate proves test deployment only; production trust is deferred to a future release.
- User confirmed Windows 10 22H2 (19045) and Windows 11. Preserve all extensions. SDK validation and actual installation are separate claims; Windows 10 desktop validation requires that OS.
- No website, stable feed, public release or production certificate store mutation.
- Public `OneWhitepaper/Aino` execution is explicitly opted in by a `validation/windows-installer-public/**` push, or by the same feature prefix plus `public-receipts-only=true` dispatch when GitHub permits it. Use only standard `windows-latest`/`windows-11-arm`; retain a typed receipt projection, never public binary/raw-workspace artifacts. Private execution/reuse remains unchanged.

## Tasks

- [x] Validate existing install stamp, App Installer strategy/recovery and package-identity baseline tests.
- [x] Add default installation/update candidate output using the existing bundle build and descriptor generator, isolated from public distribution. Validate exact commit, architecture, signer, native identity and digest.
- [x] Extend Windows acceptance to assert account workspace, historical conversation, Bot/profile and model configuration preservation; detect missing or altered records. Native execution is tracked separately below.
- [x] Add private artifact-only Windows SDK/deployment verification, including failure/cancel paths and uninstall retaining external data; forbid implicit public workflow execution and installer publication. Native execution is tracked separately below.
- [x] Run targeted local tests, typecheck and repository checks; run Windows SDK/native contracts and record host/signing limits.
- [x] Record the earlier production/acceptance reviews and distinguish implementation, contracts and outstanding native receipts. Review of the latest fixes is tracked below.
- [x] Implement explicit public receipts-only execution and complete, fail-closed 13-gate proof projection; independent review of `006d35b6b3` is clean.
- [x] Implement source-only apply and bounded UIA About scrolling at `f5d12ce3dc`; local Python, Electron, PowerShell, type/lint and repository checks pass.
- [x] Complete independent review of `f5d12ce3dc` (no Critical/Important findings) and start public standard-runner run `43801657955`; its Windows contracts job passed. Both native jobs completed with a driver UIA error after migration and preparation recovery passed.
- [x] Correct the UIA API at `3fd5e9c26c`; follow-up run `43819576334` Windows contracts job `133139302779` passed, including the actual native-control regression. x64 later failed and ARM64 stalled at replacement/automatic NEW; neither is accepted.
- [x] Add bounded package/process observations, OLD-bound waiter-stage diagnostics, deployment HRESULT projection and bounded disposable cleanup; flush migration/recovery evidence before potentially blocking teardown. Product gateway behavior remains unchanged pending evidence.
- [x] Reproduce x64 with bounded diagnostics: 282 samples confirm OLD registration unchanged and waiter package-timeout; deployment query has no matching events.
- [x] Complete and verify the expanded diagnostic/control chain on Windows: shared signed-framework UIA initialization, owned descendant activity/timeout cleanup, truthful native event-query outcomes and all existing Windows contracts (`43876559015`). This does not close native package replacement/activation acceptance.
- [ ] Establish the remaining package-replacement cause with installer-window/process facts; verify the strict confirmation selection and then reaccept the complete native lifecycle.
- [ ] Accept the latest-source test-signed package's complete native lifecycle on available x64 and ARM64 hosts.
- [ ] Verify actual Windows 11 x64 desktop, Windows 10 22H2 desktop and standard-user lifecycles. Elevated Windows Server x64 CI is not equivalent.

## Verification commands

```sh
# apps/desktop, Node 26 on PATH
pnpm exec vitest run --project electron scripts/write-build-stamp.test.mjs scripts/msix-virtualization.test.mjs scripts/msix-manifest-roundtrip.test.mjs electron/updater/app-installer-strategy.test.ts electron/updater/app-installer-recovery.test.ts electron/app-installer-file.test.ts
pnpm run typecheck
# repository, isolated HERMES_HOME and HERMES_RUNTIME_DIR
scripts/run_tests.sh tests/scripts/test_release_artifacts.py tests/scripts/test_bundle_msix_names.py
python scripts/check
```

Private CI may retain its existing access-controlled package/input artifacts. Explicit public receipts-only CI builds fresh ephemeral candidates and uploads only `aino-windows-public-receipts/receipts.json`; its fixed-field projection excludes binaries, keys/certificate state, raw logs, environment/account/history payloads and full workspaces. Candidate/native/cleanup status remain separate; acceptance requires all 13 complete and consistent evidence gates, and absent native proof is unaccepted. Any failed or skipped acceptance remains visible; no green shortcut or success based only on mock tests. Public x64/ARM64 native jobs in run `43801657955` completed with failures. Follow-up `43819576334` also has no accepted receipt: x64 failed and the stalled ARM64 job was cancelled.

## Latest native findings

- Complete installation/update acceptance remains open. Full run `43866276951`
  at `385b1b3453` failed x64 at unchanged OLD registration after 292 samples;
  ARM64 is still running. x64 artifact `14232870888` is unaccepted; migration,
  25 data checks, preparation HTTP404 recovery and owned-package/trust cleanup
  passed. There is still no accepted automatic NEW or final cancellation/
  uninstall lifecycle receipt.
- The previous provider fixture inadvertently prewarmed UIA. Actual cold start
  failed in `43880076923`; a concrete CLR initialization frame fixes the .NET
  stack-walker failure. Cold initialization passed natively in `43881625247`.
- Real App Installer observation failed as intended in `43883021594`: its
  verified package-owned UI sits beneath a host frame (one owned window, one
  hosted window, zero PID-only top-level matches). Shared discovery at
  `b7f4afdf1a` now follows the verified process-owned subtree and cancellation
  checks the same frame. Native verification `43883727629` passed all suites; its native process
  cleanup file passed on retry after one transient bare-PID assertion. The test
  now uses the existing native liveness check and a bounded three-second exit
  wait; five local process tests passed. The extended actual frame-cancellation
  step and all other suites passed in `43884580723`. Final-source contracts
  `43885299701` at `ee3525258c` passed all suites without a reported flaky retry.
- Preserve all system-package/product/new-window/ambiguity/control checks.
  This is a proven driver gap, not yet proof that package replacement works.
  No product-wide gateway stop is justified by the surviving OLD Python alone.
- Do not publish packages, feeds or website updates, merge main, or touch the
  other conversation's worktree. Run complete candidates only after focused
  native checks have passed. Fresh complete run `43885861128` is frozen at
  `ee3525258c` on independent standard runners; the older ARM64 leg is retained
  for its original evidence rather than cancelled or repurposed. Neither is
  currently an accepted complete installation/update receipt.

## Current progress as of 2026-11-16

- Focused `43873843738` at `6bd68031f5` succeeded. The owned Win32 Update
  control was Pane before explicit signed-framework provider registration and
  Button afterwards. Separate-thread/process pumping alone did not fix it
  (`43872149732`). Shared UIA initialization now serves the actual installer
  driver and timeout observer without relaxing Button/product/ownership checks.
  The successful run passed 158 Python (four skips), 74 JS (nine skips), eight
  extractor, eight SDK and 113 updater/state tests, plus native observation,
  PowerShell driver/environment and descriptor suites. Integrated shared
  initialization and the real nested-worker progress regression subsequently
  passed in `43875036256` at `0e261a89a0` with 159 Python tests (four skips)
  and all existing Windows suites green.
- Heartbeats now include the actual owned descendant tree, since a waiting
  launcher's CPU/RSS hid active build/signing workers. The real nested-worker
  regression was first red, then green with 125 related local Python tests
  (two Windows skips). Counts distinguish partial sampling; arguments and
  environment stay excluded. Native Windows verification passed in
  `43875036256`; the current full run does not include this follow-up.
- Deployment-event observation now preserves native query errors; only the
  actual `NoMatchingEventsFound` case is a successful empty query. A regression
  reproduced the former false-empty result and passed locally after the fix.
  The Windows lane will also exercise the native empty-selection error. Earlier
  `queryStatus=ok` receipts cannot rule out a suppressed read failure. The new
  Windows PowerShell 5.1 verification passed in `43876559015` at
  `5b48381c8c`, job `133331017203`: native empty-event selection and all
  existing Windows suites succeeded (159 Python, four skips; 74 JS, nine skips;
  eight extractor, eight SDK, 113 updater/state and nine observer tests).
- Full fresh run `43866276951` at `385b1b3453` failed x64; ARM64 is still in progress.
  Its Windows Python contracts passed 158 tests (four skips), including the four
  actual worker/tree cleanup tests. Contracts then stopped at a preexisting
  native listener test's 5-second unit-test default (three independently
  30-second-bounded native scans). Its explicit 120-second native-test budget
  keeps all assertions; focused run `43867819708` passed the JS step. UIA
  additions have not executed in the full run. No native acceptance has been promoted.
- Focused standard-runner run `43864177745` at `2c747067ee` skipped large
  builds and found a real candidate timeout-cleanup defect before UIA execution:
  Windows venv launcher PID 5940 was killed but worker PID 8420 remained. Logged
  cleanup now reuses Hermes tree termination; captured probes use its existing
  bounded Job Object/probe path. Explicit real-grandchild regressions failed in
  both paths before the fix and now pass locally, with a separate live sibling
  preserved. The launcher/worker PID distinction is retained in the test.
  All four real tree/timeout cases passed on Windows in `43866276951`; this
  remains separate from the unproven package-stall cause.
- Product-bound installer snapshots now project validated HRESULT arrays as
  well as fixed window states/counts; raw window/process payloads stay local.
  Latest local verification: 124 Python passed, two Windows skips; seven observer
  Node passed, two Windows skips; PowerShell parsing passed.
- Added owned-child CPU/memory/I/O/output heartbeats and final progress receipts
  because the initial live-log view did not expose whether a silent tool was
  active. Later output showed x64 had already completed migration; that view
  alone does not prove a stalled signer. Signing/packing/verification have independent
  30-minute budgets. Real-child tests failed before the implementation; 46
  related tests now pass (one Windows skip). This follow-up is outside frozen
  run `43846856927`; the earlier deployment/activation cause remains unproven.
- x64 native job `133229084011` failed at 11:42 UTC. Its 282 complete
  package/process samples confirmed unchanged OLD version, one OLD payload
  process, no OLD main, one installer and no NEW. The waiter reached
  `package-timeout`; the event query found no matching deployment events or
  HRESULT. Receipt artifact `14222743163` is unaccepted; owned package cleanup
  succeeded and test signing/trust cleanup recorded removed. Do not infer a
  gateway or signing root cause from these facts.
- Fixed the observation-budget classification: the final shortened probe must
  retain confirmed OLD state rather than invent a native query timeout. Added
  fixed-field receipt validation for the operation that exhausted the budget.
- Reused strict product/new-window binding for confirmation across all verified
  installer windows. The former first-window branch and unconditional absent-UI
  message concealed unhandled dialogs. Added a native-control contract and safe
  trigger-state projection, OLD runtime process counts, a bounded final UIA
  observation and existing 18-minute owned-job supervision for the UIA drivers.
  Native confirmation fixture passed in `43873843738`; actual package-swap
  acceptance remains outstanding. `/contracts-only`
  public refs now exercise contracts without starting two complete builds.
- ARM64 job `133229083991` also failed in `43846856927`. Migration and
  preparation passed; 250 complete observations kept OLD `2026.7666.1523.0`
  unchanged, with one OLD payload process, two installer processes and no
  OLD/NEW main. The waiter reached package-timeout; event lookup succeeded
  with no matching deployment/HRESULT. Artifact `14226887326` is unaccepted;
  owned-package cleanup and disposable certificate/trust removal succeeded.
- Removed the redundant unbounded post-NEW CIM/port scan and final parent
  package query. Existing bounded automatic-window/selected-gateway health and
  disposable-removal checks retain those invariants. Local selected-gateway and
  handoff verification passed eight JavaScript and 17 Python tests (one Windows
  skip), and PowerShell parsing passed. This follow-up is outside frozen run
  `43846856927` and does not claim native acceptance.
- Diagnostic commit `c0ff3179dc` passed local 81 Python tests, five Node tests,
  five PowerShell parser checks and all 15 repository checks. Public standard-runner
  run [`43846856927`](https://github.com/OneWhitepaper/Aino/actions/runs/43846856927)
  is frozen on `validation/windows-installer-public/20261116-native-observation`.
  Its Windows contracts job `133229083523` passed all seven observation tests
  including native package/process probes; x64 failed at unchanged package
  registration and ARM64 also failed at unchanged OLD registration. Further
  native diagnostics are needed to establish the replacement cause.
- Public standard-runner run [`43801657955`](https://github.com/OneWhitepaper/Aino/actions/runs/43801657955)
  completed at `f5d12ce3dc`. Windows contracts job `133083110675` passed: 145
  Python (four skips), 74 JS (nine skips), eight extractor, eight SDK, 113
  updater/state, seven Windows PowerShell 5.1 groups, GUI environment and four
  descriptor tests. Admission was not blocked by the private-repository quota.
- Both x64 job `133083109738` and ARM64 job `133083108952` built, test signed and
  verified OLD/NEW. Both passed released v0.1.5 ZIP chat, first-MSIX migration,
  retained encrypted login without re-login, original history, natural gateway
  rotation and all 25 state checks. The actual installed checker returned
  `AVAILABLE` with its registered source on both architectures.
- Both also passed the actual preparation HTTP404 scenario with the same usable
  OLD process and intact data. This natively validates the `f5d12ce3dc`
  source-only apply correction in that scenario.
- Both then failed before update handoff because `Show-UpdateAbout` called the
  nonexistent `AutomationElement.Compare`. The documented API is
  `Automation.Compare`. A shared helper correction and real owned-Windows-control
  contract cover own-window identity, foreign-window refusal and disabled About.
  The original one-OLD-process check remains at the driver's scroll call site.
  Mac parsing and seven pure PowerShell groups pass; native UIA validation still
  required a new Windows run. Follow-up source `3fd5e9c26c` passed the actual
  Windows PowerShell 5.1 UIA regression in successful contracts job `133139302779`.
  It accepts an independently resolved own window and rejects foreign or disabled
  controls; all existing Windows contract suites also passed.
- Actual automatic NEW, observed OS cancellation/manual OLD reopen and final
  uninstall/reinstall preservation were not reached. Both public receipts are
  `unaccepted`; disposable certificate/key cleanup recorded removed. x64 ran on
  elevated Windows Server 2025; ARM64 on elevated Windows 11. Actual Windows 10
  22H2 desktop, Windows 11 x64 desktop and standard-user lifecycles remain open.
- The public `validation/windows-installer-public/20261116` ref stays frozen at
  `f5d12ce3dc`. The correction uses frozen
  `validation/windows-installer-public/20261116-uia-binding` at `3fd5e9c26c` in
  run `43819576334`; x64 job `133139303070` and ARM64 job `133139303136` ended
  with failure/cancellation at replacement/automatic NEW. Later documentation
  updates use `codex/windows-native-acceptance`. Only curated receipts may be
  uploaded. There is no installer/release/feed/site publication,
  `main` merge, production signing or production-trust acceptance.

- Follow-up x64 failed at 08:23 UTC after its actual Update click and OLD exit:
  replacement/automatic NEW was not observed within 15 minutes. ARM64 reached
  the same wait at 09:04:09 UTC, including an observed App Installer Update
  confirmation, then emitted no progress for 29 minutes. The controller cancelled
  the stale run; ARM64 ended cancelled at 09:34:08 UTC. Both safe receipts are
  unaccepted; disposable signing trust cleanup recorded removed. ARM64 migration
  passed in console but its final migration receipt did not flush before cancel.
  No automatic NEW, cancellation/manual-reopen or final uninstall proof exists.
  The combined timeout alone cannot distinguish deployment from activation;
  bounded native observations and waiter diagnostics must precede another full
  rebuild. No product change is justified from the timeout alone.

## Historical evidence summary

Earlier runs `43767548248` and `43775234306` have completed with failures and are
diagnostic only; neither architecture is still building in those runs. Their
signed packages predate the latest production fixes. Earlier harness corrections
covered historical ZIP transport and hash verification, localized composer/model
observations, external `WindowsApps` interpreter access and navigation priority.
Diagnostic `43777044333` on older source `00e438fc2b` passed ZIP-to-first-MSIX
migration and all 25 data checks before failing later update/recovery gates.

Separate Windows contracts at `03e2136520` in run `43784313536` passed 69 Python,
74 JS (nine host skips), 71 updater/state, eight SDK manifest cases, four descriptor
tests and six actual Windows PowerShell 5.1 groups. Earlier complete tests-js
verification passed 376 tests with five host skips. These results retain their
original scope: contracts and a 19045 SDK manifest floor do not establish complete
native acceptance or actual Windows 10 desktop compatibility. The current matrix
and unchanged reproducible manual handoff are in
`apps/desktop/docs/windows-installer-acceptance.md`.
