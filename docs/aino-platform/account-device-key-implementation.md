# Account device Key implementation plan

**Goal:** Implement the approved single permanent device Key and request-scoped catalog billing for local Aino Desktop, preserving existing manual Keys, leases, subscriptions and BYOK.

**Spec:** `account-direct-model-access-proposal.md`; the subsequent approved subscription analysis clarifies that this delivery uses existing monetary subscription quotas. Image-count packs, additive packs and multi-group product bundles are separate product features.

**Architecture:** Extend existing API Key records, authentication, catalog resolver and private desktop binding. A Key identifies one account/device. `X-Aino-Model-ID` identifies the catalog option; the server validates the actual model, endpoint and current entitlement and builds a request-local group context before billing. No shared Key/group mutation or automatic paid fallback.

## Constraints

- Worktrees: Aino `/Users/zizimutou/.codex/worktrees/account-device-key/Aino`; API `/Users/zizimutou/.codex/worktrees/account-device-key-api/Aino-API`.
- Preserve the existing UI, agent prompt-cache prefix, profile/session ownership and private ticket/claim/bind channel. Never expose secrets to renderer or logs.
- Device secrets are random, returned only on creation/rotation, stored as explicit hashes server-side and through existing encrypted main-process persistence locally. Revocation never causes automatic replacement.
- New local bindings advertise `managed_device_key: 1`, accept explicit `expires_at: null`, and forward `X-Aino-Model-ID`. Old/remote paths retain leases; permanent secrets never go to remote gateways.
- No deployment, merge, release or production account/credit changes. Tests use isolated state.
- Preserve ordinary image and batch features. Subscription capability must not be advertised for balance-only batch processing.

## Task 1 — API device identity lifecycle

- [x] Add explicit `DesktopCredentialType` (`device` for new keys), device ID/version and hash storage on existing API Keys; migrate without changing old rows.
- [x] Add authenticated `/desktop/device-keys` creation/rotation/explicit reauthorization, `GET /desktop/device-keys/:device_id` state and device revocation/list integration. Existing revoked identities remain discoverable. Responses use `key_id`, `device_id`, `version`, `status`, `expires_at: null`; creation/rotation additionally return `api_key` once.
- [x] Extend API auth cache/repository lookup to validate hash-only secrets; reject stored hashes as Bearer. Invalidate both old/new secret cache entries on rotation and key/user/device revocation.
- [x] Verify real database uniqueness, concurrent create/rotate, revoke race, unchanged manual Keys and no secret in persistent responses.

## Task 2 — API request-scoped classification and billing

- [x] Resolve only explicit device-type Keys through `X-Aino-Model-ID`, validate catalog model/endpoint/purpose and current permissions, then set a copied Key/group before existing subscription/credit checks.
- [x] Keep ordinary manual/lease behavior intact and missing/ambiguous selection rejected. Reuse existing catalog/authorization caches and bound freshness; do not cache spendable balance as authority.
- [x] Support text/ordinary images and safe catalog/usage reads. Restore asynchronous image owner/group/platform/subscription from creation context for result access and retain original billing route.
- [x] Verify concurrent image/text subscriptions, zero balance with subscription, exhaustion/expiry, no implicit balance fallback, body/header mismatch and preserved async reads. Leave balance-only batch subscription disabled with a clear reason.

## Task 3 — Desktop main-process identity and local binding

- [x] Extend existing auth/storage/runtime-binding modules with account/site/device-scoped Key persistence, singleflight ensure/rotation and capability negotiation; keep management login and model identity distinct.
- [x] Preserve slots/revisions and local binding guards, remove timers/lease calls only on permanent local path, reuse Key across text/images/models/windows. Use existing catalog metadata per selection.
- [x] Retain leases for remote/older gateways, never silently downgrade after a new-path failure. Clear local secrets on explicit logout/account switch, honor remember-login persistence and expose explicit reauthorization after revocation.
- [x] Verify warm 100-message path has zero repeated credential requests; rotation/rebind, stale account replies, remember-login, remote protection and renderer secrecy.

## Task 4 — Gateway contract and integration

- [x] Extend canonical and legacy private binding contracts with `managed_device_key: 1` and nullable expiration; prohibit null expiry without negotiated new mode.
- [x] Preserve ticket, account/profile/session/purpose checks; permanent bindings have no expiry timer/hard interrupt. Pass catalog identity through existing SDK headers for primary/image/auxiliary model calls.
- [x] Regenerate wire types; verify old lease expiration, permanent binding reuse, reconnect, image/text isolation, child/aux propagation and profile boundaries through real imports under temporary HERMES_HOME.
- [x] Run covering Go, desktop Vitest/type checks and Python runner tests plus repository blocking checks; independent review, fix findings, and record remaining rollout prerequisites.

## Delivery and rollout boundary

The local implementation is complete when the validation record is green; this checklist covers source and isolated tests, not production rollout. See `account-device-key-validation.md` for evidence and limits. The isolated environment has applied migration 253 and verified two-instance revocation, bounded concurrent load and settlement de-duplication; see `account-device-key-preflight.md`. Production migration, API capability activation, selected-account/device rollout, production load measurements and a user-approved Desktop release remain rollout work. Remote parent-device delegation remains phase 3.
