# Aino integration of Hermes v0.23.1

## Release and base

The Aino checkpoint was merged separately in PR #39, at main commit
`72669a0c31b495e4e5fb4d9d6e20c56c9b6c3f21`. This integration imports the exact
Hermes v0.23.1 stable release, commit
`3b421578588243f920886e6fe79a6faa87ea026e`, while retaining that checkpoint's
desktop and account behavior. The upstream tag object is
`b65acf3fdc1d43bd889211ea8e37032974b395a5`.

Although upstream calls this a patch release, the window contains 2,578
non-merge commits and 2,781 changed files. Its functional additions include
gateway-owned groups and remote peers, shared saved gateway connections,
real-browser sign-in import and credential Vault integration, transcript
reads, plugin RPC/hooks, and the pnpm workspace toolchain. The live plugin
catalog's response size limit is increased from 2 MiB to 16 MiB.

## Integration boundaries

- Desktop retains Aino's palette, typography, spacing, Bot navigation,
  group-chat layout, notifications and tabbed tool panel. New gateway/group
  controls use the current Aino components and capability checks.
- Browser and summary motion preserve their existing hosts and account
  partitions. The summary remains conversation-owned. Sign-in import,
  profile rename/delete and deferred IPC capture the requesting account and
  route; deleting a remote profile never mutates a local browser's cookies.
- Saved connections are shared within the owning account's runtime home.
  Account activation retires the previous watcher and drains its asynchronous
  teardown before changing roots. Explicit keychain encryption is preserved
  in both shared files; Python refuses credential use or modification when
  native unlock is required. OAuth tokens remain bound to their gateway URL.
- An interrupted encryption change keeps already encrypted credentials
  readable and reports the native policy back to Settings. A failed opt-out
  cannot silently discard a credential that could not be decrypted.
- Managed Aino model calls retain account/model authority, billing status and
  the prohibition on replaying a dispatched request through another provider
  or credential. New Bots continue to inherit the saved built-in, provider
  or custom default, with session overrides staying local to that session.
- Permanently retired Aino conversation cloud sync stays retired. Upstream
  shared gateways and group peer links are separate capabilities.
- Installed Aino help, the offline handbook, generated protocol contracts and
  prompt surfaces include the imported capabilities. Actual third-party
  names, licenses, protocol identifiers and user-defined identities remain
  accurate.
- The workspace uses pnpm with direct consumer dependencies and a frozen
  lockfile. GitHub-hosted CI runners and the complete test lanes are retained.
  Code-health acceptance is limited to findings inherited from the exact
  upstream commit; Aino changes and new merge regressions remain blocking.

## Verification

Verification is recorded against the final source and PR checks before merge.
No production deployment or installer publication is part of this integration.

- Desktop, Electron and E2E TypeScript checking passed; staged lint hooks
  passed across the Python and JavaScript workspaces.
- The complete renderer suite passed in one final run: all 1,937 files and
  16,265 cases, including ordinary chat, Bot/groups, settings and tool panels.
- The complete Electron suite passed: 464 files, 4,472 cases; 11 files and
  67 cases were skipped by their existing host/environment requirements.
- Seven real Electron/API cases passed together against the latest build:
  account A-to-B-to-A homes/history/Chromium isolation; ordinary, Bot, group
  and delegated-child identity; both widget send bridges and theme tokens;
  built-in, official-provider and custom default-model inheritance through
  real provider requests; and same-account Bot recovery after sign-in.
- Eleven additional native panel cases passed, covering tabbed tools,
  browser/terminal lifetime, file edits and saves, summary ownership, viewport
  stability, keyboard/focus and reduced-motion transitions.
- Shared credential changes were exercised through real store files before a
  watcher tick. Replaced or revoked credentials fence late refresh success
  and rejection without affecting another gateway. Those regressions failed
  before the fix and passed with the coordinator and store suites afterward.
- Generated contracts, prompt surfaces, installed offline help, managed
  inference, and encryption/OAuth/browser-sign-in boundaries passed their
  targeted runtime regression suites. Full CI remains authoritative for the
  complete Python, platform, plugin-catalog and workspace matrix.
- All 14 local repository checks passed. The final code-health comparison
  reports zero new findings; its 69 inherited findings match the exact
  reviewed upstream revision and remain visible in the report.

The 99 committed icon targets were regenerated on Linux x86_64 with the
lockfile's SHA-256-verified Pillow 13.0.0 and resvg-py 0.5.0 wheels. The 69
changed files differ only in container/PNG encoding: decoded pixels, native
ICO/ICNS frames and color metadata match the previous assets exactly. All 32
unabbreviated asset sizes reported by the Linux CI failure match these outputs.
The generator's full `--check` passes for all 99 canonical outputs. Aino's source
art and rendered appearance are preserved; the original strict regeneration,
structure and Git byte-diff gate remains enabled without exceptions.
