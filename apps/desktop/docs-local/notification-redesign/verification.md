# Notification redesign verification

Historical acceptance record: `$TMPDIR/...` references below identify evidence from the original machine's temporary directory. They describe that run, are not commands to execute, and do not imply the raw logs are included in this checkout or still available. Committed screenshots retain their existing links.

Date: 2026-11-09. Source checkout: `codex/bot-creation-context-repair`.
Scope and ownership: [implementation.md](./implementation.md).

## Automated checks

- Full UI regression: **14,865 tests, 14,829 passed, 36 failed on the initial
  run**. This run took place while final integration was still underway. Its
  result is not represented as an all-green final full-suite run.
- Every failed suite was subsequently fixed and rechecked. Failures were missing
  notification-reset/Alert test dependencies, one missing Russian overlay key,
  a stale model display-name assertion, and the summary hover regression below.
  Seven routing/state mock suites passed **218 tests**; the Screen identity suite
  passed **5 tests**; the combined locale, model-refresh, notification and owner
  recheck passed **21 tests**. No production behavior was weakened to satisfy a
  test, and original Screen/routing assertions were preserved.
- Final shared notification/dialog check: **7 files, 31 tests passed**. This
  covers queue readers and expiry, asynchronous failures, single-flight actions,
  account/source epochs, fixed dialog header/footer, confirmation lifecycle,
  diagnostics consent and root-crash recovery.
- Specialized recovery/dialog group: **12 files, 97 tests passed**.
- Sync, billing, Quick Entry and request-owned prompt group: **9 files,
  64 tests passed**. Earlier group batches also passed. These batch totals
  overlap and must not be summed as distinct tests.
- Final menu-name/confirmation regression batch: **3 files, 43 tests passed**,
  followed by another successful full desktop typecheck and build.
- Full desktop `npm run typecheck`: passed (renderer, Electron, E2E and builder
  config types).
- Production `npm run build`: passed. This builds local desktop assets; it does
  not publish an installer.
- ESLint for final main notification and shared dialog files: no errors or
  warnings. Additional surface batches had no errors; eight pre-existing test
  document warnings remain in the vault tests.
- `git diff --check`: passed across the working tree.
- Impeccable source scan on the notification frame, CSS, Alert, Dialog and
  ConfirmDialog found no regex findings. The tool explicitly notes that this
  source-only scan does not assess rendered contrast; rendered review below is
  separate evidence. Specialized surface scans were also reviewed.

Raw full-suite result: `$TMPDIR/aino-notifications-ui-results.json`.
Final local logs: `$TMPDIR/aino-notifications-final-{targeted,typecheck,lint,build,detect}.log`.

## Rendered behavior

Browser checks use real imported desktop components, styles, theme and locale
providers with a conspicuous “真实组件验收 · 模拟数据” label. Actions are local
test stubs: no real history deletion, paid task, credential upload or disk
cleanup is performed.

| View | Evidence |
| --- | --- |
| Desktop light/dark, 1440×900 | `review/desktop-notification-panel.png`, `review/desktop-notification-panel-dark.png`: the reading panel sits alongside the retained draft and uses fixed actions |
| Narrow summary, 390×844 | `review/narrow-summary.png`: summary text, recovery controls and dismiss control remain readable |
| Narrow long diagnostics | `review/narrow-long-detail.png`: no page horizontal overflow; diagnostic content wraps inside the single panel body, actions remain visible |
| Narrow recovery failure | `review/narrow-recovery-failure.png`: failure remains visible, recovery can retry, draft remains mounted |
| Long destructive confirmation, 900×600 | `review/confirm-error.png`: fixed title at y=46–90, body at y=90–489 and fixed actions at y=489–554; page width matches viewport (900), failure remains readable |

The destructive confirmation initially focuses Cancel, disables all competing
activation/dismissal while its operation is pending, remains open after a
rejected operation and closes only after a successful retry. Failure and success
were observed through the actual controls. The temporary viewport override was
reset after responsive checks.

Opening and closing detail originally left a hovered summary pinned. A failing
regression test reproduced it; clearing presentation hover/focus when opening the
panel fixed it, and the same test then passed. New arrivals no longer retarget a
notification being read. Reading, hovering and keyboard focus pause expiration
independently.

A separate read-only visual review of six light/dark/narrow/failure captures
found no blocking readability, overflow or control-occlusion problem.

## Real desktop smoke

The existing running desktop was refreshed through its View → Reload menu from
this checkout's built `dist/index.html`. The signed-in account and selected bot
conversation remained intact. The app reached its normal shell without a crash.
Its composer was empty: “继续推进” and “细化这个请求” are rotating placeholders,
not user-authored drafts. Draft preservation is verified in the real-component
fixtures, not inferred from this empty desktop composer. The session menu opened
the real shared deletion confirmation with focus on Cancel; Escape closed it and
the conversation remained. No deletion was submitted. Evidence:
`review/desktop-confirm-smoke.png`.

The smoke check exposed a stored “Bot Chat” label in a bot's deletion copy,
although its tab displayed the bot name. The shared session-actions boundary now
resolves that specific session's existing owner caption for deletion copy.
It does not read the selected foreground owner or rename the persisted key;
operation targets and rename/export semantics remain unchanged. A behavior
regression covers another bot's menu, subsequent bot renaming and safe cancel.
The final desktop build was reloaded, and its actual confirmation was observed
to name “创建修复验证”, matching the visible tab and bot.

Production-service recovery, real diagnostic transfer and native OS dialogs are
not established by the synthetic fixtures. Their existing owners, consent and
native boundaries are preserved and covered by behavior tests where applicable.
