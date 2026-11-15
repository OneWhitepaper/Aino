# Windows installer and online update implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the approved installation/update scope without publishing packages or production feeds.

**Goal:** Provide installable Windows candidates and exercise the existing App Installer update lifecycle while preserving ZIP users' state.

**Architecture:** Retain the existing MSIX/App Installer owner, build stamp and graceful handoff. Generate candidates in an isolated private CI job with a disposable test certificate; never confuse test signing with production release acceptance. Reuse the canonical `%APPDATA%/Aino` data root rather than copying account state into a second root.

**Tech Stack:** Electron 44, electron-builder, Windows SDK, PowerShell, existing Python bundle/release scripts and Vitest.

**Spec:** The user's approved five-step installation/update/data-preservation/Windows-acceptance request in this conversation. New installers and stable feeds must remain unpublished.

## Constraints and rulings

- Original UI worktree remains untouched; work is isolated on `codex/windows-installer-update`.
- Keep Copilot key registration, native aliases, profiles, account isolation and local data.
- Production signing credentials are currently absent. A disposable CI certificate proves test deployment only.
- User confirmed Windows 10 22H2 (19045) and Windows 11. Preserve all extensions. SDK validation and actual installation are separate claims; Windows 10 desktop validation requires that OS.
- No website, stable feed, public release or production certificate store mutation.

## Tasks

- [x] Validate existing install stamp, App Installer strategy/recovery and package-identity baseline tests.
- [x] Add default installation/update candidate output using the existing bundle build and descriptor generator, isolated from public distribution. Validate exact commit, architecture, signer, native identity and digest.
- [x] Extend Windows acceptance to assert account workspace, historical conversation, Bot/profile and model configuration preservation; detect missing or altered records. Native execution is tracked separately below.
- [x] Add private artifact-only Windows SDK/deployment verification, including failure/cancel paths and uninstall retaining external data; forbid public workflow execution/publication. Native execution is tracked separately below.
- [ ] Run targeted local tests, typecheck and repository checks. Run available Windows private CI and record precise limits where no native host/signing credentials exist.
- [ ] Review the patch and produce an acceptance report distinguishing implemented, locally tested, Windows-tested and blocked production-signing/OS-specific checks.

## Verification commands

```sh
# apps/desktop, Node 26 on PATH
pnpm exec vitest run --project electron scripts/write-build-stamp.test.mjs scripts/msix-virtualization.test.mjs scripts/msix-manifest-roundtrip.test.mjs electron/updater/app-installer-strategy.test.ts electron/updater/app-installer-recovery.test.ts electron/app-installer-file.test.ts
pnpm run typecheck
# repository, isolated HERMES_HOME and HERMES_RUNTIME_DIR
scripts/run_tests.sh tests/scripts/test_bundle_release_artifacts.py
python scripts/check
```

CI may store encrypted-access GitHub artifacts in the private validation repository only. Any failed or skipped acceptance remains visible; no green shortcut or success based only on mock tests.

## Native evidence so far

- At `c374f48e67`, private run `43747784200` completed the Windows SDK/contracts job:
  10 Python behaviors (including actual signing-key/trust creation and cleanup), eight real
  SDK pack/unpack identities, 65 Electron updater/state contracts, GUI-environment restoration,
  and App Installer descriptor checks passed. Host: Windows Server 2025, not Windows 10.
- Source `c374f48e67` completed OLD/NEW package build, signing and verification. Native
  deployment, UI cancellation and automatic relaunch remain unaccepted. Final production
  source `00e438fc2b` is building separately on x64 and ARM64 in private run `43754848326`.
- The actual published `v0.1.5` ZIP-to-MSIX migration is implemented with pinned artifact
  hashes and a natural gateway-owner transition. It requires the existing encrypted login
  and original database rows, without re-login or stopping the old gateway in the harness.
- Private reuse run `43756740982` passed the real SessionDB preflight but timed out downloading
  the 2.61 GB historical ZIP on its first transport attempt. It was cancelled to retain
  diagnostics and switch to live stage output; this was not a native installation failure.
- At `4f07b05322`, NEW, native OLD, preparation recovery and cancelled-update reopen all require
  retained encrypted authentication, authenticated profile reads and zero new login requests.
  Scoped review passed; related Vitest results: 61 passed / 4 host-specific skips. The full
  repository check passed all 15 checks. Private run `43762437470` uses this stricter harness
  against the pinned signed `c374f48e67` artifacts; no native pass is claimed yet.
- `43762437470` was superseded before native installation by `43763420107` at
  `412de61082`. Its known-size historical download uses bounded concurrent HTTP ranges,
  verifies each range and the complete size/SHA-256, and cleans partial files on failure.
  Related Vitest results: 70 passed / 4 host-specific skips; six extractor tests and all
  15 repository checks passed. Independent scoped transport review found no important issue.
  This is acceptance transport only; production update ownership is unchanged.
- Windows 10 22H2 runtime and production-signing receipts are still missing. No package,
  website or production feed has been published or promoted.
