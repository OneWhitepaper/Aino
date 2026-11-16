# Windows installer and online update implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the approved installation/update scope without publishing packages or production feeds.

**Goal:** Provide installable Windows candidates and exercise the existing App Installer update lifecycle while preserving ZIP users' state.

**Architecture:** Retain the existing MSIX/App Installer owner, build stamp and graceful handoff. Generate candidates in isolated standard hosted CI with a disposable test certificate; private jobs retain inputs and explicit public jobs retain curated receipts only; never confuse test signing with production release acceptance. Reuse the canonical `%APPDATA%/Aino` data root rather than copying account state into a second root.

**Tech Stack:** Electron 44, electron-builder, Windows SDK, PowerShell, existing Python bundle/release scripts and Vitest.

**Spec:** The user's approved five-step installation/update/data-preservation/Windows-acceptance request in this conversation. New installers and stable feeds must remain unpublished.

## Constraints and rulings

- Original UI worktree remains untouched; work is isolated on `codex/windows-installer-update`.
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
- [x] Complete independent review of `f5d12ce3dc` (no Critical/Important findings) and start public standard-runner run `43801657955`; its Windows contracts job passed. Native results remain pending.
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

Private CI may retain its existing access-controlled package/input artifacts. Explicit public receipts-only CI builds fresh ephemeral candidates and uploads only `aino-windows-public-receipts/receipts.json`; its fixed-field projection excludes binaries, keys/certificate state, raw logs, environment/account/history payloads and full workspaces. Candidate/native/cleanup status remain separate; acceptance requires all 13 complete and consistent evidence gates, and absent native proof is unaccepted. Any failed or skipped acceptance remains visible; no green shortcut or success based only on mock tests. Public x64/ARM64 native jobs in run `43801657955` remain in progress.

## Current progress as of 2026-11-16

- `006d35b6b3` completes the existing public workflow's explicit opt-in and safe
  receipts-only output. The projection requires 13 matching candidate, migration,
  automatic-NEW, recovery, state and cleanup gates before reporting accepted;
  incomplete diagnostics remain unaccepted. Independent review is clean. Local
  Python contracts passed 111 tests with two native Windows skips; repository,
  staged and hook checks passed. The root pushed reviewed `f5d12ce3dc` to the
  public opt-in ref and started run `43801657955`.
- `f5d12ce3dc` contains the two fixes diagnosed from the actual latest x64 run.
  Apply now reads the current package's registered source using the existing
  checker's `--source-only` mode, preserving identity, configured-source and URI
  checks without repeating networked availability. Unknown/source errors still
  stop before side effects. The existing UIA driver scrolls the matched About
  inside the bound OLD window, then refreshes visibility/enabled state and the
  whole navigation selection; ready/busy Check now retains priority.
- Local verification for `f5d12ce3dc`: 29 Python tests passed with one native
  Windows projection probe skipped on Mac; 72 related Electron tests passed;
  seven pure PowerShell contract groups passed on macOS PowerShell 7.5.4. Full
  desktop typecheck, changed-file lint/format, all 15 repository checks and the
  commit hook passed. UTF-8 BOM and CRLF remain in the Windows scripts. Independent
  review is clean with no Critical/Important findings.
- Public run [`43801657955`](https://github.com/OneWhitepaper/Aino/actions/runs/43801657955)
  at `f5d12ce3dc` passed Windows contracts job `133083110675`: 145 Python passed
  (four skips), 74 JS (nine skips), eight extractor, eight SDK, 113 updater/state
  tests across 14 files including source-only flow, seven Windows PowerShell 5.1
  process/navigation/localization groups including offscreen About, the GUI
  environment suite and four descriptor tests. Pure PowerShell contracts do not
  prove actual UIA scrolling. Both x64/ARM64 native jobs completed checkout and
  started setup, and remain in progress; public standard-runner admission was not
  blocked by the private-repository billing limitation.
- Root froze `validation/windows-installer-public/20261116` at `f5d12ce3dc`;
  documentation updates use a separate ref to avoid restarting native builds.
  Packages and disposable signing keys remain in the ephemeral runner; only curated
  receipts may be uploaded. There is no installer/release/feed/site publication,
  `main` merge, production signing or production-trust acceptance.

## Latest native evidence

Current public run `43801657955` is testing the reviewed `f5d12ce3dc` source on
standard x64/ARM64 runners; complete native results remain pending.

Earlier private run
[`43783849762`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43783849762)
uses the earlier signed source `27bbc1d8f2de0a28b51f83bb07cd0c787586fea4`.
Its x64 job failed after verified partial progress; its Windows 11 ARM64 job is
still in progress and has no accepted receipt.

- On Windows Server 2025 x64, OLD/NEW build, signing and verification passed.
  Released v0.1.5 ZIP chat, first-MSIX installation, retained encrypted login
  without re-login, original history, natural gateway-owner rotation and all 25
  account/Bot/configuration/file checks passed. Candidate cleanup recorded removal.
- The actual installed Electron checker returned exit 2, `AVAILABLE`, the
  registered loopback source URI and empty stderr. The PackageManager lookup and
  identity workaround therefore worked on that host.
- Preparation recovery hid the descriptor before apply, whose repeated networked
  availability check timed out after 20 seconds before the HTTP404 download
  stage. Later the separate UIA main path stalled at Settings/My account with
  About below the viewport, exhausting 300 seconds without scrolling. There is
  no evidence that this second failure was another checker timeout. These two
  causes motivated `f5d12ce3dc`, which still needs native revalidation.
- Actual automatic NEW, preparation recovery, observed OS cancellation/manual
  OLD reopen and uninstall/reinstall preservation remain unaccepted. Windows
  Server 2025 x64 does not establish Windows 11 x64 or Windows 10 19045 desktop
  runtime coverage. Both desktop lifecycles and standard-user execution remain
  untested. Only test signing is authorized; production trust is deferred.

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
