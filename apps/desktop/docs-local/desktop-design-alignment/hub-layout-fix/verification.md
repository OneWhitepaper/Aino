# Agent Hub layout regression verification

2026-11-10. This follow-up addresses the two user screenshots supplied after the desktop design alignment. It supersedes the earlier visual verdict for the Agent Hub header and primary conversation layout.

## Root causes and changes

- Conversation scoping hides the ordinary `workspace` tab when a bot or group owns the primary zone. Header placement and minimize policy incorrectly treated that filtered list as the zone's structural identity. Both now use the zone's complete pane membership. The primary bot/group title occupies the existing 43px native window bar; independent split titles stay local, and the group member toolbar remains intact.
- All minimize entry points converge on `setTreeGroupMinimized`, which now protects groups containing an uncloseable pane. The persisted-tree migration restores only an erroneously minimized primary workspace group, retaining its active pane, split weights and tab-strip preference. Navigation and tool folds are preserved.
- Hiding the Agent Hub navigation column incorrectly switched the conversation scope to Sessions. Only the Sessions pane becoming visible now expresses that transition. Callback ordering and cancellation of pending bot opens are covered.
- Canonical group composers used component-local text and attachment state although a window-local group draft cache already existed. They now reuse that cache, keyed by exact connection, profile, immutable room ID and account lifetime. The existing account-change boundary clears the shared draft cache. Send intent remains in its existing journal; an ACK retires only the matching draft revision and payload. Late upload callbacks from an unmounted or previous-account view cannot write into a subsequent draft.
- Projecting group titles into the window bar exposed a static-label path. The title now retains its existing reactive tab renderer, so group-name changes remain live.

## Automated evidence

- Header regression first failed for bot/group placement while ordinary Sessions passed. The added live-name case also failed before using the reactive label.
- Primary-zone regression first failed for both collapse entry points and old persisted-state recovery. Independent tools remained collapsible.
- Group draft remount, account boundary and delayed-upload regressions were demonstrated failing before their fixes.
- Broad related regression: 78 files, 435 tests passed, including pane-shell layout, navigation, group workspace, plugin visibility, canonical reopen and draft behavior.
- Final upload-lifetime change: four affected suites, 37 tests passed, including the newly added delayed upload/unmount/remount scenario.
- Final desktop typecheck, scoped ESLint, production build and `git diff --check` passed. The layout detector returned no findings for the changed header/group surfaces.
- A fresh independent reviewer compared the supplied screenshots with the rendered group capture and reviewed the added header, collapse, navigation, draft, journal and upload changes. No unresolved findings remained after fixing the live title and late upload issues.

## Native desktop evidence

The existing signed-in development canary loaded the newly built `apps/desktop/dist/index.html`; no installer was produced.

- `group.png`: one aligned window title, normal roster width, full conversation and composer; no right collapsed main rail.
- `bot.png`: robot conversation title shares the window bar and does not add an extra local title row.
- `ordinary-session.png`: returning to Sessions restores its own title and conversation.
- `sidebar-hidden.png`: hiding navigation keeps the same group and its unsent draft.
- `draft-retained.png`: entering text in the group, switching to Aino, then returning to Agent Hub restores the same group and exact text. The temporary test text was cleared afterward.

Also exercised group-history search (four matches), opening/closing group information, selecting an existing robot, and opening/closing settings. No messages, paid model calls, deletions, sign-outs or account-setting changes were performed during this UI verification.

Conversation-owner navigation remains window-local by its existing contract; this change does not add cross-restart group-selection persistence. No whole-layout reset, commit, push, API deployment or desktop release was performed.
