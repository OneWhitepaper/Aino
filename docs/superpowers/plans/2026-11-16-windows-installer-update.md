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
- Ruling: provisionally evaluate Windows 10 22H2 (19045) and Windows 11, preserving all extensions. SDK validation and actual installation are separate claims; Windows 10 desktop validation requires that OS.
- No website, stable feed, public release or production certificate store mutation.

## Tasks

- [ ] Validate existing install stamp, App Installer strategy/recovery and package-identity baseline tests.
- [ ] Add default installation/update candidate output using the existing bundle build and descriptor generator, isolated from public distribution. Validate exact commit, architecture, signer, native identity and digest.
- [ ] Extend Windows acceptance to assert account workspace, historical conversation, Bot/profile and model configuration preservation; detect missing or altered records.
- [ ] Add private artifact-only Windows SDK/deployment verification, including failure/cancel paths and uninstall retaining external data; forbid public workflow execution/publication.
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
