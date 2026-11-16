# Verification — 2026-11-09

## Final implementation

Preserve the original AINO heading, 80px logo, centered form, control proportions,
agreement and remember-device preference. Phone registration now has one short
hint with an Info Popover for existing-account binding. All nine languages are
covered. The existing-account, WeChat and registration links share one centered,
wrapping row with 16px horizontal gaps and unchanged13px type.

AccountLoginLinks and AccountPhoneLoginHelp are presentation only. Existing
callbacks, registration/phone/legal policies, account store, native window and
credential protocol remain authoritative. Stale form feedback is dismissed on
method changes, busy navigation is locked, explicit phone-disabled capabilities
fall back to existing login, and TOTP Back keeps the original entry/challenge.

## Checks

- Login card, navigation and AccountGate:40tests passed after final layout change.
- Account store:9tests passed during the prior hint correction (unchanged).
- Locale catalog/coverage/overlay:27tests passed.
- Renderer typecheck, targeted ESLint and production build passed.
- Final Impeccable detector returned no findings (`[]`).

CUA rendered the production component with shared ThemeProvider in an isolated
fixture. Callbacks were synthetic; this proves presentation/interaction and does
not claim a new live SMS/password acceptance. The active native account was not
signed out. Tests cover registration recovery and policy/terms/invitation
payloads, phone code/cooldown, browser session-only preference, second factor,
error scope and loading navigation lock.

340×600 viewport: width340, cardheight476.09375px (55px less than the original
vertical-link version); three links share top486.546875 and a19.5px row. At260px
they wrap to two rows (rowheight47px), without horizontal overflow. Help expands
on demand and Escape closes it with focus restored. Light/dark hints checked.

Current screenshot:
`/Users/zizimutou/.codex/visualizations/2026/11/09/aino-login-simplification/login-inline-links.png`

Other screenshots in that directory show earlier layouts and are superseded.
Temporary fixture/server removed. No commit, push, deployment or installer.
