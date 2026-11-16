# Notification implementation

Mode: Operate. Approved direction: the interactive notification preview dated
2026-11-09 (`aino-notifications-v2`). This change implements that direction in
real desktop components; it does not publish an installer or change OS-owned
notification windows.

## Presentation and ownership

- The existing notification store is the sole queue and action owner. One
  in-flow summary and a notification/status reading panel replace the two
  over-modal corner stacks. Main, HUD and Browser pop-out use their actual
  content frame; no terminal, editor, conversation or draft is remounted.
- Long content wraps through the complete shrink chain. The panel body owns
  scrolling, while its actions and title stay accessible. Narrow layouts keep
  the workspace mounted but inert until the reading panel closes.
- A hidden summary remains in the pending list. Passive identical feedback
  merges; actionable entries require explicit owner IDs to merge safely.
  Hover, keyboard focus and detail reading independently pause expiry, including
  a sticky notice that becomes expiring feedback while being read.
- Actions await returned work and keep failures in place. The single-flight
  token survives same-ID updates. A replaced notification cannot be dismissed
  by an earlier completion. Epoch and logical-instance fences prevent a new
  account/source from inheriting old details, focus or hidden presentation.
- Agent notices use connection/profile/code IDs. Maintenance refuses another
  foreground source; a seven-day disk snooze uses the existing owner-bound
  slash command only when its originating session is available and the command
  positively acknowledges the saved snooze. No UI action enables cleanup by
  default, claims large recoverable space, or executes displayed diagnostics.
- Background restart remains an intent-based recovery. Submitting that intent
  is not evidence that the service recovered; existing boot/reconnect state
  continues to describe the result.

## Surface audit and implementation coverage

The audit found 73 files using DialogContent, 45 using ConfirmDialog and a large
set of notify/notifyError callers. Shared primitives update those callers without
turning their business forms into notices. The following custom paths were also
reviewed and adapted:

| Group | Covered paths and behavior |
| --- | --- |
| Global feedback | NotificationStack, notification store, complete diagnostic reading/copying, inline Alert shrink/wrap chain |
| Decisions | Dialog/ConfirmDialog/ConfirmHost fixed actions, safe cancel focus, synchronous duplicate guard, failure/retry; model assignment uses the shared confirmation |
| Delete/revert operations | Session menu, tile delegation, Command Center, connections registry, local model delete and Review preserve real Promise results and close after success |
| Connection recovery | Primary reauthentication IDs, real reconnect failure propagation, primary-route guard, remote-display deduplication |
| Conversation/account state | Free-tier strip, restored draft, platform history, session controls, cloud sync, billing and sync status card |
| Agent Hub | Group connection, read, attachment and mention errors; Screen warnings/errors occupy flow space rather than cover the remote view; SDK exposes the same Alert primitives |
| Consent/install | Metrics consent, real browser-profile consent, plugin preview consent, MCP install, plugin-install notices and third-party model errors retain their original approval and write semantics |
| Special recovery | Update hold, boot failure, remote setup, desktop install and root crash preserve their own state machines; root crash reuses the diagnostic consent/upload host rather than a dead action |
| Prompt input | Sudo, secret and vault errors stay with their exact request; reconnect never resends a secret or changes approve/deny policy |
| Auxiliary window | Quick Entry keeps its bounded mini-window and one scroll boundary; HUD and Browser retain their own lifecycle |

Native Electron message boxes for quitting active work, credential transfer and
startup/update recovery remain native. They may run before a renderer exists.
Tool approvals retain their session/request queue and once/session/always/deny
semantics. External web content, terminal output and user artifacts retain their
content styling; only Aino-owned chrome and notices are in scope.

## Verification

Behavior tests exercise real components/stores against isolated stubs, including
failure/retry, exact scope, stale results, duplicate activation, cancel/escape,
consent, draft retention and long unbroken diagnostic content. Full UI regression
and failure-set rechecks are recorded separately in `verification.md`.

Screenshots in `review/` use actual components and theme providers with clearly
marked synthetic data. They validate layout and interaction, not paid model
execution, real deletion or a production diagnostic upload. Native desktop
checks preserve the signed-in account and do not send a paid task.
