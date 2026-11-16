# Desktop design alignment — 2026-11-10

The approved 2026-11-09 notification prototype is the visual authority for this change. The desktop retains its real controls, destinations, account scopes and editor lifecycles. This is an implementation of the selected visual system, not a new layout proposal.

## System and coverage

- Default light/dark palette, system font stack and remembered custom font preference are owned by ThemeProvider.
- Body/navigation 14px, UI/actions 13px, supporting copy 12px, section headings 16px and dialog headings 18px.
- Control/row 6px, card 14px, menu 12px, floating panel 16px and composer 20px corners.
- General-purpose icon adapters use 128 official Codicon geometries. Eight symbols with no equivalent retain correct semantics at a shared 16-unit viewport and optical stroke weight, with their actual provenance recorded. Brands, user/bot portraits, file-type assets and specialized semantic icons retain their identities. Geometry provenance and license are stored alongside the adapter.
- Shared Button, input/select, menus, popovers, Dialog/Sheet, tabs, badges, pagination and pane controls propagate the same system to their consumers.
- Local overrides were aligned across chat/composer/sidebar, model selectors, settings/account/login, workspaces, capabilities/connectors/plugins, messaging, Agent Hub/group chat, file/review/terminal panel chrome, imports, cron and other app-owned page chrome. Exact files are in `changed-files.json`.
- User-authored content, terminal/code/diff/chart semantics, native OS chrome, logos, portraits and scaled Appearance thumbnails are intentional content exceptions.

## Notifications and behavior

The summary is a right-aligned 380px card below its host header. It has its own layout footprint and compact text actions. The active workspace owns it; settings and layouts with no visible workspace use the shell fallback. Both frames read the existing queue, and only the active frame presents or pauses notices. The mounted transcript/draft subtree is retained across foreground changes.

A real desktop check caught a missing percentage-height constraint in the pane-hosted notification wrapper. The wrapper now fills its parent so long transcripts scroll within the pane and the composer stays in the window.

The notification detail panel wraps long paths, scrolls its body and keeps its footer accessible. Confirmation dialogs retain cancel/focus, pending and failure handling. No real deletion, payment, model request or account switch was used in this visual acceptance pass.

## Verification

- Complete renderer, Electron, E2E and builder configuration type checks: passed.
- Production desktop build: passed.
- Full UI regression: 14,880 tests, initially 14,875 passed and 5 failed. Two failures came from the workspace-header harness missing Router after the real notification frame gained route awareness; three were assertions tied to the replaced pixel values. The original functional/identity/lifecycle assertions remain.
- Final rerun of all affected files plus notification and assistant identity coverage: 6 test files, 66 tests passed. The full suite was not repeated after these test-only repairs.
- Changed-source ESLint: 0 errors; 2 existing warnings (a test document access and a floating-pane hook dependency).
- Changed-source Prettier and whitespace diff checks: passed.
- One source-only Impeccable detector pass over 214 targets: 89 findings, including 10 primary regex findings and 79 advisories. The raw report is retained in the local run logs; this is not a rendered contrast audit. Contextual review distinguishes preserved font registrations, platform brand colors, scaled previews, decorative initials, native/content semantics and actual UI drift. Mechanical title/radius findings were corrected without rerunning the detector.

## Rendered evidence

`review/desktop-chat.png`, `desktop-models.png`, `desktop-account.png`, `desktop-appearance.png` and `desktop-group.png` are captures of the signed-in Electron development desktop at its actual window size: chat/models/group at 3168×1850 physical pixels, and the final account/appearance captures at 3012×1850 (approximately 2× CSS pixels). They demonstrate shared typography, page balance, neutral controls, identity-safe avatars and the retained real controls. Current backend service states are displayed truthfully; this visual run does not certify the remote services.

The notification light/dark and 390px captures, long-detail capture and long confirmation capture use real production components with explicitly labeled synthetic data/actions. They exercise wrapping, scrolling, error/recovery actions, Escape cancellation and retained draft text without destructive operations.

Independent full visual review returned `fix` for two material findings: the cloud-history card touching the profile card, and generic icons still falling back despite an available Codicon equivalent. Both were addressed in one fix batch and recaptured. Account/cloud-sync tests: 10 passed; icon adapter tests: 5 passed. The additional nonblocking modal-notification difference was also addressed: an open shared dialog hides the background summary without changing its layout footprint or queued state, and Escape restores the summary and draft.

`review/notification-light-final.png` (1280×720), `review/notification-long-detail-narrow-final.png` (390×844), the replaced `review/confirmation-dark-long.png` (1280×720, actual dialog-open bytes) and replaced account/appearance images are the final evidence for this batch. Final full typecheck/build passed again after the batch.

The independent verdict is **ship, limited to the fixlist**: account spacing, general icons/semantic compatibility, and notification suppression during confirmation all scored **resolved**. The reviewer inspected the new evidence and exact official SVG geometry. This verdict does not imply another exhaustive review of every page, state or backend service. The result is recorded in `review-verdict.md`.

## Working tree

Changes remain in `codex/bot-creation-context-repair`, based on local HEAD `97299a64d9`, alongside pre-existing user work. No commit, push, API deployment or desktop installer publication was performed.
