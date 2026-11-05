# Aino desktop account authentication

The desktop opens signed-out primary and session surfaces in a compact native
login window. The login screens retain the existing Figma `24:6`, `24:40`, and
`24:76` geometry. After authentication, Electron restores the saved workspace
bounds before React mounts the chat layout. HUD and browser pop-out windows are
not converted into account windows.

Production identity is owned by the Electron main process and is independent of
the selected Hermes gateway, profile, project, or SSH connection. The renderer
uses the narrow `platformAccount` preload bridge and receives only revisioned
safe snapshots, public policy, masked identity fields, and structured error
codes. Access tokens, refresh tokens, temporary TOTP tokens, captcha proofs, and
arbitrary platform HTTP access never enter renderer state.

## Sign-in behavior

The normal flow is phone number, the current server agreement when enabled,
optional invitation code when registration policy requires it, and the
server-configured verification-code length. Resend timing and 429 recovery use
server values. Captcha is acquired by the dedicated main-owned captcha window
only when public policy enables a supported provider; the login form never
shows a fake captcha control.

Existing email accounts use email and password and continue through the
existing TOTP challenge when required. WeChat remains an explicit unavailable
route until the service enables a real integration. Platform development mode
still honors the local platform server's challenge and validation rules; it
does not imply the fixed code `1234`.

Settings → My account shows the canonical platform user ID, masked phone,
verified email, nickname editing, and sign-out. Nickname writes map to the
platform's existing username update. An offline account retains the last
verified profile and offers an explicit retry. Only `signed_out` and
`reauth_required` return an account surface to login.

## Isolated platform development

Ordinary `npm run dev` uses the platform bridge. To point an unpackaged build at
an isolated loopback platform fixture, create
`platform-development.json` in that run's isolated Electron user-data directory:

```json
{ "enabled": true, "origin": "http://127.0.0.1:PORT" }
```

Then bundle main in development mode with
`node scripts/bundle-electron-main.mjs --dev`. Packaged builds ignore this file
and always use the fixed production origin.

The prior gateway `account.json` implementation remains only as an explicit
local UI fixture. Run `npm run dev:legacy-account` to select it. This adapter is
never selected after a platform error and is never available in a packaged
build. Its local records are not imported, promoted to platform users, or
deleted during migration.

## Wallet, orders and device authorization

My account also hosts the platform wallet, recharge/order history and device
authorizations. These use the narrow `platformBilling` bridge: main verifies
the current owner, sanitizes fields and preserves decimal amounts. A payment
browser action accepts an order ID, not a renderer-supplied URL; main reads the
current owner's order before opening the validated checkout destination.
Closing a recharge dialog does not cancel an order. Unknown create outcomes
retain the same request identity; matching history can recover the original
order. Success requires both a completed order and an authoritative wallet read.

Device actions are fenced to the expected user and generation. Revoking the
current device invalidates managed runtime bindings; normal website API keys
and custom provider configuration are not treated as desktop leases.

Device authorization shows active, expired and revoked states separately. Active
rows explain that Aino renews temporary model credentials while in use; exact
credential deadlines are available under temporary credential details. These
deadlines describe model access, not whether the account is signed in.

See the [user guide](aino-platform-user-guide.md) and
[current implementation status](implementation/aino-platform-progress.md) for
capability limits and outstanding end-to-end/platform checks. Fixture receipts
are not proof of real SMS delivery, paid inference or payment settlement.

## Validation commands

```sh
cd apps/desktop
npm run test:ui -- src/app/account src/api/platform.test.ts src/store/account.test.ts src/app/settings/account-settings.test.tsx
npm run test:desktop:platforms -- electron/platform-auth.test.ts electron/platform-client.test.ts electron/platform-ipc.test.ts electron/platform-captcha.test.ts
npm run typecheck
npm run build
node scripts/bundle-electron-main.mjs --dev
npx playwright test e2e/platform-account.spec.ts --reporter=list
```

The native fixture uses isolated `HERMES_HOME` and Electron user data, a local
platform HTTP server, the real main/preload bridge, and fake tokens. It does not
contact the production API or send SMS.
