# Model recovery, account isolation, device names and floating notices

Date: 2026-11-11. Local source validation; no desktop installer or production deployment.

## Model recovery

Model-selection failures retain their original diagnostics and partial output. A successful
model application acknowledges only the failures captured before that application. They become
an expandable historical entry instead of an active recovery card. Failed, cancelled and
deferred applications do not acknowledge failures. A later failure remains active, including
when it has the same error code or partial output as an earlier failure.

The shared message repository derives recovery after a cold history read from an actually
committed model-switch marker or a subsequent successful final response. Primary conversations,
Bot conversations and other conversation tiles use this same path. No stored user message or
failed turn is deleted, and no past model context is rewritten.

## Account isolation

The native A → B → A test exercises separate data homes and Chromium partitions, retirement
of old account windows, sidebar contents, current route, message contents, search and REST
history access. It records the actual account adapter, account ID, mode and runtime home.
Foreign account sessions are absent and cannot be read through the other account's native API.

This test passed. A read-only inspection of the existing local account workspaces found no
mixed bound principals or mismatch with their workspace scope. The exact screenshot showing
the original account's history was **not reproduced**, so this work does not claim a newly
identified data-isolation root cause or silently migrate/claim any historical data.

After validation, the latest development desktop was started from this checkout. Its native
bridge confirmed the platform adapter, signed-in production account mode and an account-scoped
runtime home, with no legacy account-number prompt visible. It did not use the shared legacy
development adapter.

The exceptional read-only safeguard remains in place. Its copy no longer exposes an internal
account number; it retains the action to start a conversation with the current account.

## Computer names

Electron reads macOS ComputerName, with a bounded native probe and hostname fallback; other
supported desktop systems use hostname. Unicode names use the existing installation_name
metadata field. Updating a name does not mint another installation ID or Device Key.

The desktop device list consumes that metadata. The Aino-API keys page joins the existing
device metadata by device_id and shows the computer name, client type, OS and version.
Missing metadata and older API versions keep their existing fallback. Older clients cannot
retroactively supply the friendly name of a different computer.

API frontend changes are in the existing aino-device-info-api worktree. They do not require
a database migration. They are not deployed by this task.

## Notifications

Main-window, Browser and HUD notifications share the existing floating card. Workspace
notifications no longer reserve a header row, narrow the content or hide the draft. Feedback
has its own stacking level so later workspace content cannot intercept its buttons. Lists,
details, action failures and deferred reminders retain the original queue and action owner.

Hovering or focusing an actionable list row independently pauses its expiry. Moving focus
within a row keeps it paused; leaving or closing the card releases its readers. Reader tokens
include the notification epoch and instance, preventing reuse after account changes.

## Verification

- Desktop targeted UI suites: 329 tests passed across 21 files, including cold recovery,
  reconciliation, model switching, account guards, notices and device presentation.
- Electron account/device suites: 103 tests passed across 10 files.
- API keys and locale suites: 43 tests passed; API vue-tsc and frontend build passed.
- Chromium notification interaction tests passed for toolbar and auxiliary workspaces at
  1440, 720 and 360 pixels. Content/composer rectangles, history scroll and draft values remain
  unchanged on notice appearance, detail opening and dismissal. Cards stay within the viewport.
- Native account switching passed against isolated homes and loopback fixtures.
- Full desktop type checking, build, targeted ESLint and all 14 repository check lanes passed.

Fixtures use temporary homes and inert credentials. No production account, subscription or
paid inference request was used in these tests. Existing unrelated worktree edits are preserved.
