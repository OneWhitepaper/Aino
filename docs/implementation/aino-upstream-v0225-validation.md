# Aino / Hermes v0.22.5 compatibility validation

## Scope and provenance

- Aino starting commit: `c40559e54913d58d3db7861f5d448805b6429586`.
- Reviewed stable upstream: `bf0203a794a07aac3ff764972ab9087baa4e4f4e` (`v0.22.5`).
- Branch: `codex/aino-upstream-v0225`, using the existing isolated integration worktree.
- Import uses a two-parent merge, preserving the four pre-existing Aino branding,
  consent-based diagnostics, transcript-spacing and built-in-model-readiness fixes.
- The daily checkout/profile, running development desktop, production services,
  installer feeds and published downloads are outside this validation.
- Engine integration does not publish a new desktop installer. Desktop package
  versioning remains a separate release operation.

## Compatibility decisions

| Seam | Result |
| --- | --- |
| Delegation | Import the upstream provider/route/plugin contract; retain Aino per-task effort, visible context, managed credentials and fallback behavior in the same child lifecycle. |
| Account and billing | Preserve Aino model/account authority and recovery actions; integrate upstream usage-window gauges and plan actions through existing contracts and settings primitives. |
| Model menu | Retain Aino pending/disabled and owner-scope guards; add upstream recommendations, usage markers and selection behavior. |
| Settings | Reuse Aino section/group layout for routing, plugin management and sound muting; preserve existing settings navigation and profile ownership. |
| Transcript and workspace | Retain compact replies, hidden-footer spacing fix, Summary card and project-folder ownership. |
| Session contracts | Regenerate TypeScript/OpenRPC from merged Python contracts, including both Aino metrics/billing and upstream plan gauges. |
| Dependencies and CI | Import the upstream locked graph/toolchain; retain the Aino macOS-signing dependency override, usable hosted Windows runners and occurrence-based health provenance. |
| Locales | Keep Aino product copy, import extracted notification dictionaries, translate the new None choice and connector offer, and remove retired keys from existing fallback declarations. |
| Product documentation | Keep Aino readmes and add the upstream agent-import workflow, rather than replacing the product homepage. |

No parallel delegation manager, account manager, scheduler or model tool was added.

## Concrete integration regressions

1. The new route validator rejected Aino's existing `reasoning_effort` and
   `context_turns` task fields as undeclared plugin parameters. Adding them to
   the existing reserved-core parameter set preserves plugin validation without
   creating another routing path. Removing this adaptation caused five existing
   loopback tests to fail; the corrected delegation set passed all 29 tests.
2. Upstream first-launch readiness copy hid the real error for an explicitly
   configured custom model. `evaluateModelDefaultReadiness` now forwards the
   resolved provider to the existing runtime check; built-in Aino models still
   use the existing platform-model path. The affected readiness/settings set
   passed 114 tests in ten files.
3. Model-menu integration exceeded the existing function-length ratchet. The
   keyboard-row type now sits with the file's other data shapes, outside the
   component. The component measures 298 owned lines; runtime behavior and
   selection guards are unchanged, with all 35 model-menu tests passing.
4. The upstream routing slot was initially placed above Aino's entire combined
   Model page, making its Subagent defaults heading appear before the main-model
   controls. It now uses the existing delegation field group and subpage filter.
   Main/auxiliary settings remain independent. A native placement test failed on
   the misplaced slot, then both native appearance/placement tests passed after
   the fix; the affected settings unit set passed 17 tests in three files.

## Verification environment

- Native host: macOS arm64.
- PM-locked Python: 3.14.9; Node: 26.12.1; npm: 12.0.2; Electron: 44.9.3.
- Python environments were built with Hermes PM, including the full CI optional
  extras for the broad suite. All Python tests use `scripts/run_tests.sh`.
- Deterministic native checks use the existing real Electron/Python/Aino-API
  fixture and disposable database. Inference stays on loopback; no paid model
  calls are made. The disposable interpreter carries only the fixture's existing
  startup network/credential guard. Production Python path scrubbing is retained.
- The API fixture is the isolated v0.22.4 validation copy, whose source provenance
  and pre-existing fixture adaptations are documented in
  `aino-upstream-v0224-validation.md`; each run records the API source and diff.
- A release main bundle disables the legacy-account test adapter intentionally.
  Native source checks therefore use the repository's existing `--dev` main
  bundler with the freshly built renderer.

## Local results

| Check | Result |
| --- | --- |
| Delegation compatibility | 29 passed; five red tests without reserved-parameter adaptation |
| Readiness/settings/billing focus | 114 passed, ten files |
| Desktop TypeScript | Passed all renderer, Electron, E2E and builder-config checks |
| Desktop production build | Passed, including the post-review build |
| Shared workspace | Typecheck/lint passed; existing warnings retained |
| Bootstrap installer frontend | Typecheck/lint passed |
| Ink workspace | Typecheck passed |
| TUI workspace | 1,852 passed / 30 skipped, 239 passing files / one skipped file; typecheck, keys and lint passed |
| Web workspace | 449 passed, 65 files; typecheck/lint passed |
| Root JS consolidated check | 42 passing files; 263 passed / four skipped; typecheck and lint passed |
| Renderer consolidated suite | 1,490 passing files / three failing files; 12,458 passed / three failed / two skipped. All three affected files subsequently passed five tests in one isolated run. |
| Electron consolidated suite | 403 passing files / ten skipped files; 3,847 passed / 38 skipped |
| Python full suite | 6,668 files; 66,312 passed / 27 failed / 1,849 skipped, with four additional file timeouts. The full set of 14 failed/timed-out files subsequently passed together: 213 passed / nine skipped / zero failures, retries disabled. |
| Native account/model/tools/wallet | Passed |
| Native workspace switch | Passed |
| Native compression/resume | Passed; all three native scenarios passed in 7.9 minutes |
| Native Chinese settings and routing placement | Two passed; actual label geometry stays on one line and routing/defaults remain in the subagent group after the main-model controls |
| Static guards | All eleven non-health checks passed again after the test-fixture repairs |
| Occurrence-aware code health | Final integration commit: 24 retained allowed findings / zero unwaived blockers; exit zero |
| Linux catalog lane | 29 files / 629 passed / zero failures, retries disabled; original five fixture failures reproduced before the repair |
| Linux managed-lease contracts | Three passed with retries disabled after aligning the test's finish wait with its unchanged 45-second subprocess budget |
| Hosted initial Python full suite | 6,668 files / 67,088 passed / five failed / 979 skipped. All five failures are the catalog fixture mismatch above; one lease file passed on retry and is recorded below. |
| Hosted initial source CI | macOS, Windows x64/arm64, JS/TS and static checks passed; Python/catalog blocked only by the five fixture failures above. Repair follow-up not yet run at this source freeze. |
| Hosted PM bundles | darwin-arm64, darwin-x64, win32-x64 and win32-arm64 all passed |
| Hosted Nix package checks | Initial desktop-backend probe failed; test-brand/font-environment repair awaiting hosted validation |
| Hosted release/install/update E2E | Not run by the ordinary PR workflow; skipped jobs are not counted as passes |

These are separate results; a passing focused rerun does not rewrite a failing
initial broad run as an all-green first attempt.

## Initial failures and their disposition

- The first desktop build correctly rejected inputs edited during compilation.
  Rebuilding after those edits passed; the freshness guard was not weakened.
- Electron's first dependency fetch was too slow. The same public archive was
  obtained from a mirror, verified against Electron's packaged SHA-256, and
  installed through the existing runtime preparer. The checksum is
  `4af51382278d00291dfcda265eddd9bab6e98cebb09f46aadc8438bf606de162`.
- The renderer's initial full run reported seven failures in five files:
  custom-model readiness, overlay/translation coverage and two timing-sensitive
  onboarding/speech files. The readiness and locale defects were corrected;
  all affected files subsequently passed. A consolidated run is recorded above.
- A new upstream OAuth-error assertion expected Hermes although the retained
  Aino production copy was correct. The expected product name was aligned.
- The root launch-failure test hardcoded Chromium's `--no-sandbox` flag although
  Aino's smoke driver deliberately keeps the sandbox enabled. It now verifies
  the actual invalid Chromium switch and nonzero exit captured in the receipt.
- The real native-compilation fixture repeatedly exceeded its default five-second
  unit timeout (about eight seconds). Its bounded timeout now matches the
  surrounding native-build cases at 30 seconds; production timeouts are unchanged.
- One plugin-validator action probe used Xcode's Python 3.9 because the initial
  shell lacked the PM environment on PATH. Its captured traceback identified the
  unsupported `datetime.UTC` import. With the locked interpreter on PATH, the
  unmodified test passed. Native toolchain requirements were not bypassed.
- Initial auxiliary-concurrency, quick-command-tree, native-ingress, clarification,
  schema-browse and multi-client failures passed unmodified follow-ups and the
  final two-worker affected-file run. The renderer's terminal-layout, onboarding
  and cross-window speech files passed a one-worker follow-up. These preserve the
  initial timing failures; they do not prove timing sensitivity is eliminated.
- The client-toolchain tests assumed the first PATH entry was a user's tool
  directory, omitting the deliberately prepended Hermes console-script directory.
  They now compare the user toolchain after that owned entry, retaining their
  session/daemon isolation assertions. The unchanged launcher-prefix tests run
  beside them: 105 passed and four skipped across both files.
- An earlier incomplete-environment suite's launcher had been interrupted but
  left its child runner alive. It was identified by its exact PM interpreter and
  owned runner command, then its 18 owned descendants were stopped and reaped.
  This duplicated the full-suite resource load before discovery; timeout results
  from that period require revalidation and are not proof of product defects.
- The interrupted-update fixture minted a launcher on the editable test venv.
  When its bootstrap was deliberately removed, that environment's finder loaded
  the real worktree bootstrap and CLI instead of the fixture's inert application.
  An instrumented launch confirmed both module origins and the unrepaired fixture.
  The fixture now uses the base/store interpreter, matching production
  `stage_launcher`; all 14 recovery tests passed without changing launch code.
- Three offline build/admission fixtures accidentally acquired a new tool store.
  The desktop failure test now isolates dependency preparation before its failing
  builder; the subdirectory plugin-update test reuses `admission_env`; and the
  dependency-override tests invoke the real PM operations with the existing local
  toolchain seam. Real wheels, lock resolution, scans, rollback and validation
  remain exercised. These passed 21 and 16 tests respectively; no production
  download or dependency policy was weakened.
- Telegram's cancellation test checked admission ownership before the cancelled
  task's scheduled done callback ran. Tracing showed the existing callback
  releasing the claim immediately after that assertion. The test now waits with
  the existing bounded asynchronous condition helper; all 94 replay/admission
  cases passed. The adapter itself is unchanged from the reviewed release.
- The optional native settings probe initially waited at the Aino login screen:
  its older fixture did not opt into or sign into the existing development
  account. It now uses the same explicit development-account setup and login
  controls as the other native appearance tests. Production authentication and
  packaged-build restrictions are retained. Its old immediate-parent text lookup
  was also stale after the settings-row refactor; it now measures the visible
  label through the actual accessible controls. Both final native cases passed.
- The first hosted catalog run passed 624 tests and failed five import-admission
  cases. Their Linux-only fixture still substituted the previous release's SHA,
  leaving the new workflow pin absent from the fixture commit graph. The helper
  now substitutes the existing `UPSTREAM` assignment instead of matching an old
  release hash. The production workflow, exact reviewed pin and rejection cases
  remain unchanged. Local macOS skips did not establish Linux coverage. A real
  Linux arm64 container reproduced all five failures, then passed the entire
  29-file catalog lane (629 tests) with retries disabled after the fixture fix.
  The first broad container attempt also lacked the PM-installed `uv` directory
  on PATH; supplying the actual toolchain path resolved its setup errors without
  modifying the tests or dependency policy.
- The first Nix package build completed, but its headless desktop-backend probe
  did not observe readiness. The probe still matched literal Hermes log lines
  although the retained Aino branding now renders the existing product name;
  its minimal build sandbox also reported missing font configuration and a
  renderer font assertion. The probe now imports the existing desktop identity,
  carries a Nix-generated font configuration for the sandbox, and includes the
  desktop log in timeout diagnostics. The production launcher and backend
  selection policy are unchanged. Hosted validation of this repair is pending.
- The first hosted Python run reported one retry-passing lease file. Its
  subprocess was allowed to run for 45 seconds, but the test killed it after
  waiting only 25 seconds for the finished event. The fixture now derives its
  waits from that existing run budget plus a bounded teardown allowance; its
  normal-final, credential rotation, unchanged-prefix and no-leak assertions
  remain intact. All three cases passed in a real Linux container with retries
  disabled (13.4 seconds). This focused result does not erase the initial flake
  or establish long-run timing stability; the hosted follow-up remains pending.

## Evidence and remaining boundaries

Private local logs use `/private/tmp/aino-v0225-*`; native screenshots and receipts
are under `/private/tmp/aino-v0225-native-platform-results`. Those artifacts are
not committed with synthetic account or credential data.

This source-freeze record preserves the initial hosted results. Final checks on
the repaired head are tracked in [PR #16](https://github.com/OneWhitepaper/Aino/pull/16)
and its linked Actions runs; a later green run does not replace these failures.

The accepted-upstream health check retains inherited findings in the report and
still blocks new occurrences or worse metrics. Its exact baseline SHA above is
also recorded in the hosted lint/contributor/catalog workflows. Both the staged
two-parent tree and the real integration commit were checked; the committed-tree
command exited zero with 24 retained allowed findings and no unwaived blockers.

An independent read-only review was attempted, but the collaboration tool
delivered an empty task to the reviewer, which returned no review. The integration
seams were manually reviewed against both parents; no independent-review pass is
claimed.

macOS native evidence does not establish Windows/Linux native behavior. Hosted
platform jobs and release-specific install/update tests remain distinct from
this source compatibility upgrade. No installer has been signed, notarized,
published or deployed as part of these local checks.
