# Aino / Hermes v0.22.6 compatibility validation

## Scope and provenance

- Branch: `codex/aino-upstream-v0226` in the existing isolated worktree.
- Aino baseline: `e86635e60e81c9365c4c0d7dd1a2270e9832c319`.
- Stable upstream: `f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab` (`v0.22.6`).
  Its annotated tag object is `49138a605822a48a0cc4824a7723f09276786861`;
  these identify the same upstream commit after peeling the tag.
- The original in-progress merge and all 183 conflict resolutions were retained.
  The integration preserves both histories with a two-parent merge.
- Main, the public 0.1.4 Mac release, update feeds and production Aino-API are
  outside this change. Desktop package/release versioning remains a separate
  operation; importing the engine release does not publish an Aino installer.

## Compatibility matrix

| Surface | Preserved and integrated behavior |
| --- | --- |
| Aino shell | Existing neutral light/dark palette, icons, brand menu, sidebar, home, composer, combined settings/account navigation and compact dialogs remain the presentation baseline. Upstream controls use the existing primitives and localized copy. |
| Chat and Agent Hub | Ordinary/Bot Mode switching, Chinese bot names, preview-before-switch, canonical bot chat identity, normal chat history/draft restoration and upstream group actions remain. Passive Bot inspection does not request provider setup for that Bot. Explicit send/setup still targets its captured owner. |
| Workbench | File/browser/terminal/review share the existing tabbed panel, with close/hide/restore, legacy-layout migration, file search/edit/save, dirty confirmation, split views and Git controls. Summary stays with its chat. |
| Models | Aino built-ins and configured custom/provider models remain; selection is per chat, new sessions follow the configured default, and original reasoning controls are retained. Upstream model reset, routing, auxiliary/delegation defaults and plugin aliases use the same runtime. |
| Aino account | Native login, encrypted remember-login, wallet/recharge/subscriptions, device management, usage and order recovery remain under Aino authority. Text/image bindings preserve account revision, profile owner, lease lifecycle and claim-before-credential ordering. |
| Images | Image model selection remains independent of text models; the UI offers Aino image models with automatic quality. Generation and reference-image edits retain the existing image tool, renderer and billing purpose. Failed edits do not silently become fresh generations. |
| Service authorization | Existing Nous/provider services remain available with explicit service ownership under Providers. Aino Account remains the wallet/billing destination. CLI disconnect commands use a terminal bound to the initiating provider owner. |
| Web Access | New upstream access controls and restart serialization remain. Start/stop/restart, status polling and query-cache writes stay on the initiating gateway/profile, including after navigation. Native/local capability checks and Nous sign-in requirements remain. |
| Browser account bridge | Pure native account/client/parser/binding logic was extracted to shared modules. Browser transport uses the real Aino client and authorized profile-bound gateway tickets; native persistence/CAPTCHA/filesystem diagnostics remain native. Browser login is visibly session-only. |
| Runtime | ConfigBackend, provider/plugin/browser migrations, delegation, compression, streaming, approvals, cron policies and cached prompt observers follow upstream lifecycle. Aino managed routes and profile ownership remain at the existing seams. |
| Metrics | Existing opt-in queue/send/withdrawal machinery records Aino recipient and destination atomically. No inherited Nous consent authorizes Aino collection. |

The baseline home BrandMark predates this integration and was retained. The 166
paths deleted relative to the Aino baseline were also absent from the upstream
tag; migrated capabilities such as Copilot/Camofox retain upstream plugin/catalog
migration guidance rather than a second implementation in core.

## Integration findings and fixes

1. Remote consent writes now commit the entire answer atomically. A refused
   recipient/destination/withdrawal change leaves caller data and consent windows
   unchanged and does not report success.
2. Custom-endpoint updates/deletion commit configuration last and roll back
   local config/env/auth bytes on refusal. Rollback snapshots only the affected
   slots in each real publication target, preserving injected credentials,
   absent values and unrelated external/managed secrets. Routed profiles never
   publish into the launch process environment.
3. Provider alias classification no longer treats an alias such as `meta` as a
   canonical built-in merely because its owning plugin is bundled. Configured
   provider precedence and official/custom identity remain distinct.
4. Provider CLI disconnect uses the existing terminal queue with a target tab
   identity. A different owner's active tab cannot consume the command.
5. Web Access operations capture one owner through mutation, restart polling
   and cache publication. A second profile's status cannot complete the first
   profile's operation.
6. Passive onboarding uses the selected computer's default profile; explicit
   setup retains the active/captured Bot owner. The native test also exposed an
   old fixture that declared `OPENAI_API_KEY` but wrote only `MOCK_API_KEY`.
   Fixing that fixture preserves upstream's intentional strict secondary-profile
   credential checks. A real two-profile RPC test proves credentials are not
   copied or lost.
7. Browser remember-login copy now states session-only behavior and hides the
   unsupported checkbox; native remember-login is unchanged. CAPTCHA-unavailable
   guidance and new Web Access/account copy are present in all nine locales.
8. An exhausted balance/subscription formerly changed a verified platform model
   to restricted and exposed first-run BYOK setup over Account settings. The same
   owner now retains its already-verified onboarding access for account recovery.
   Model selection still rejects restricted models, and first-run, sign-out,
   changed owner, unsupported gateway and general unavailability do not inherit
   readiness. Regression: two red failures, then eight passed; affected set:
   15 files and 71 tests passed.

Independent reviews covered runtime, settings/owner routing, browser/native
account extraction, infrastructure and feature retention. The runtime reviewer
was later assigned R3 implementation; the coordinator separately reviewed the
final publication/rollback code and reran five related files: **92 passed**.
The reviewer-author's own green receipt is not counted as independent approval.

## Environment and evidence

All verification used isolated homes and synthetic credentials. Python tests
ran through `scripts/run_tests.sh`, using PM-built Python 3.14.9 with dev/test,
all, keychain, fal and premium TTS extras. JavaScript used Node 26.12.1, npm
12.0.2 and the locked workspace graph. Electron 44.9.3 was prepared through the
canonical runtime tool with its checksum-verified cached archive.

Logs and screenshots are in the local temporary `aino-v0226-integration` directory; lane/review
receipts are in the local integration ledger. These are local validation
artifacts, not published release assets.

| Check | Actual result |
| --- | --- |
| Full Python first run | 7,153 files; 70,163 passed, 48 failed, 28 errors, 2,041 skipped. 27 files failed, including four import/collection failures. |
| Python failure rerun | All 27 failed files plus four relevant additions: 31 files, **1,032 passed, 0 failed, 50 skipped**. Later credential rollback independent rerun: five files, **92 passed**. |
| Desktop UI first / second | First: 14,254 passed, 44 failed. Second: 1,753 suites passed, one failed; 14,307 tests passed, one failed. The last failure was a storage mock that targeted the prototype rather than the actual Node 26 test storage object; its corrected suite passed 14/14. |
| Desktop UI final | After the final billing-recovery fix: **1,754 files and 14,312 tests passed, 0 failed**. |
| Electron final | **433 files passed, 11 skipped; 4,231 tests passed, 66 skipped**. |
| Shared / TUI / web / root JS | All check commands exited 0. TUI: 244 suites, 1,879 passed, 30 skipped. Web: 21 suites, 144 passed. Root JS first had one interpreter-PATH failure; corrected rerun passed. Existing lint warnings remain. |
| Desktop types and lint | Final renderer/Electron/E2E/builder typecheck exited 0. Desktop ESLint: 0 errors, 354 warnings. Post-fixture E2E typecheck also exited 0. |
| Source builds / generated contracts | Final Desktop and browser source builds exited 0. RPC/OpenRPC freshness check and locale-key generation passed. |
| Blocking source checks | Full staged snapshot: **14 checks, all passed; 0 blocking health findings, 6 advisory**. Interim Ruff fixture-export warnings were corrected. The unstaged blob-size scan tried to fetch computed worktree blob IDs from the partial clone and timed out; the actual staged tree passed. |

First-run failures were investigated rather than hidden. Corrections included
updated facade/mocking seams, explicit loopback HTTP clients unaffected by host
proxy settings, Bash-version-neutral contracts, actual catalog/custody fixtures,
optional dependency groups, public frozen updater exports and real case-sensitive
volume detection. The initial full Python run was not repeated wholesale after
these corrections; its failed files and new regressions were rerun explicitly.

## Native end-to-end and visual acceptance

Native tests run the real Electron main/preload/renderer, Python agent and
isolated Aino-API handlers/database with loopback inference/payment fixtures.
Transport guards reject external traffic and credential reads before transport;
real account authentication is performed against the isolated API.

- The first native set passed 17 tests, failed 16 and skipped one. Eleven
  failures were an unavailable worktree-relative Aino-API path; subsequent runs
  explicitly select the existing API checkout without modifying it.
- File/workbench tests cover legacy restoration, search, dirty-save/close,
  review docking, terminal tabs and project ownership. Settings/reasoning and
  sidebar account rerun: **three passed**. Native account sign-out confirmation
  and cross-window invalidation rerun: **one passed**.
- Native image generation/editing: **one passed**. It verifies independent
  model selection, automatic quality, `/v1/images/generations`, reference-image
  `/v1/images/edits`, rendered pixels, image-purpose usage and leak auditing.
- Final Agent Hub: **three passed**, including ordinary chat/draft restoration,
  default Bot persistence/reload and Chinese names/advanced ID/workspace switching.
- The complete platform-native run reached **eight passed, six failed, one
  skipped**. The six failures were investigated: repeated tool IDs in the fake
  upstream, stale Retry/error-details/exact-balance/confirmation selectors, and
  the removed manual quote button. Corrections preserve the real UI and original
  counters. Source changes after a Playwright worker starts require a new run;
  the earlier stale-selector run was explicitly interrupted rather than reported
  as completed.
- Website independent login/wallet: **one passed**. Recharge with automatic
  quote and independent website verification: **one passed**; exact quote was
  20.5 CNY including 0.5 CNY fee, credit 2.8 USD, one order/payment despite duplicate
  signed callbacks, matching desktop/site balance, zero inference usage and leaks.
- The complete managed native journey passed after fixture corrections:
  independent Aino login, real Python read_file/tool roundtrip and wallet debit,
  cancellation/drain, native recharge, close/restart/history restoration and
  fresh binding, workspace/account preservation, custom-provider switch without
  Aino wallet usage, and independent website wallet verification. Compression
  and this journey were **two passed** in the three-case rerun; offline recovery
  remained failed there and is tracked separately rather than called green.
- Final native inference faults passed after the billing-recovery product fix:
  visible rate-limit details and explicit retry, bounded service recovery,
  exhausted-balance refusal before upstream inference, zero charge for rejected
  requests and recovery through the real Account page.
- Final offline/revoked-authorization scenario: **one passed**. It preserves
  both windows' cached identity during an outage, explicitly recovers wallet,
  exact balance, history and devices, rejects the revoked lease before upstream
  inference, confirms sign-out, reauthenticates and resumes a billed tool turn.
  Its independent ingress gate retains the exact expected event with a
  45-second bound; the earlier five-second poll expired during the full UI run.
  The generic history read error is accepted only inside billing history while
  the fixture is deliberately offline, and explicit history recovery is asserted.
- The coordinator visually inspected representative light/dark file surfaces,
  docked Review tabs, Aino model-menu geometry, Chinese combined Model settings
  and generated/edited images. Existing Aino tokens, layout and controls remain.

The website-wallet fixture substitutes one exact hardcoded decorative CloudFront
image URL in the served login-layout script with the site's existing local SVG.
It does not edit Aino-API or its built files, mock authentication/wallet handlers,
or relax the zero-external-transport assertion. Receipts disclose that fixture-only
decoration substitution.

The synthetic Go inference provider originally reused one tool-call ID for every
turn and rejected Hermes' valid session-wide ID normalization on the next turn.
An Aino E2E `go test -overlay` changes only that test provider in a private copy:
issued IDs are unique and responses must match the nearest assistant's exact
read_file ID, path and real fixture content. Production API handlers and the API
checkout remain unchanged. A two-turn regression failed before this overlay;
afterward both turns succeed and five invalid pair/content/history cases reject.
Every run saves the source SHA, hashes, overlay and two-line diff. Native tests
continue to require original usage/tool counts, billing and zero external traffic.

All six failures from the completed platform-native run have passing replacement
receipts: compression, offline/revoked recovery, inference faults, two accounts
on one site, recharge/website wallet and the complete managed journey. The whole
15-case native file was not rerun once more after these focused corrections;
the final status is the full-run result plus those explicit passing reruns.

Final local receipts: `desktop-ui-full-fourth.log`,
`desktop-electron-full-third.log`, `python-full-failures-rerun.log`,
`runtime-r3-root-second.log`, `desktop-typecheck-signoff.log`,
`desktop-lint-signoff.log`, `desktop-build-acceptance.log`,
`webapp-build-acceptance.log`, `static-staged-signoff.log`,
`native-final-rerun.log`, `native-account-recovery-final.log`,
`native-recovery-acceptance.log`, `native-offline-signoff.log`,
`recharge-autoquote-focused.log` and `native-image-first.log`.

## Native image dimensions follow-up

The OpenAI-compatible executor previously always selected one of three aspect
presets, and the Aino wrapper did not forward an explicit size. The existing
provider capability mechanism now exposes optional `size` (`auto` or positive
`WIDTHxHEIGHT`) for Aino/OpenAI, including reference edits. Generation JSON and
edit multipart requests preserve the explicit pixels and automatic quality.
Invalid syntax rejects before credentials; API rejection does not retry or
downgrade. Original image bytes remain unchanged. `requested_size` is distinct
from header-derived `actual_size` / desktop-compatible `pixel_size`; unknown or
different output dimensions carry an explanatory note.

- Regression first: all **14 cases failed** on the previous implementation.
- Focused image/provider/schema/managed-auth/billing suites: **181 passed** in
  14 files through `scripts/run_tests.sh`, with file retries disabled.
- Native account image generation/editing: **one passed** (48 seconds), using
  isolated real API handlers and synthetic upstream pixels. Automatic quality,
  original/source pixels, image-purpose ledger entries and transport/leak guards
  remain verified. This does not establish the production route's native 4K
  output; a model may reject or return different dimensions.
- `scripts/check --staged --base HEAD`: **14 checks passed**, with zero blocking
  or advisory code-health findings. Independent patch review found no blockers.
- New tool controls apply to a new conversation; existing prompts and history
  are not rewritten. API production code and the API checkout are unchanged.

## Attached image presentation follow-up

Canonical gateway text-vision preprocessing stored the auxiliary image description as
user-authored content. The gateway now persists the caption and retained `@image`
references, using the existing clean-content/API-sidecar contract. Model-facing
vision enrichment stays intact; native image parts also survive the clean override.
Queued turns, recovery scaffolding, captionless images and mixed image/voice/file
attachments use the same separation. The legacy TUI and canonical gateway share the
existing image persistence helpers, extracted to `agent/image_routing.py`.

History readers recover old image presentation only from an exact admission ID,
matching session owner and byte-verified retained attachments. This adds display
content in REST and WebSocket projections; stored content and API replay are not
rewritten. Missing or unbound attachments cannot be recovered by this projection.
Image verification runs off the canonical owner event loop.

- Regression cases reproduce text-vision persistence, captionless native input,
  queued input and recovery failures before the fix; real SessionDB flush/reload
  verifies clean display content and unchanged model sidecars.
- Desktop Electron acceptance uses an isolated synthetic development account and
  mock model responses. Real composer selection, text-mode vision preprocessing,
  model input and cold reload pass: the user sees the original image and caption,
  while the auxiliary description remains model-only. No production account or
  paid inference is involved.
- Final focused regression run: **29 passed** across eight files. Related image
  routing/native/replay suites: **43 passed**; API sidecar/recovery/history suites:
  **86 passed**; the full legacy TUI server file: **632 passed**. The final Electron
  text-vision acceptance passed in **13 seconds**. Root static checks: **14 passed**,
  with zero blocking or advisory code-health findings. Independent review found
  no blockers.
- The original uploaded image is retained; this fix does not replace it with an
  image reconstruction or modify its pixels. Release remains on hold.

## Desktop interaction and status follow-up

- Summary output links use the existing preview store's explicit URL matching mode:
  different outputs retain separate tabs and the same live URL focuses its tab.
  Matching reads the current browser page, preserving page navigation and state.
  Ordinary browser navigation, source ownership and file/artifact identity remain
  on their existing paths.
- Paused replies use the shared transcript scaffold, localized copy and a quiet
  pause icon aligned with the message column. The composer keeps the existing
  continuation action in a flat status row; stop/continue and saved progress are
  unchanged.
- Cold startup shows the Aino mark, current boot phase and real progress, with
  reduced-motion support. Existing soft switches, reconnects, recovery and slow
  startup exits retain their lifecycle.
- Automatic legacy provider cards no longer cover the workspace. Credential
  failures offer the existing Settings → Model destination and retain the draft.
  The explicit action restores the failing connection/profile before selecting
  the actual settings scope; failed or superseded switches do not open another
  owner's settings. Background credential errors do not capture foreground
  ownership. Manual OAuth/API-key authorization, account sign-in and free-tier
  notices retain their existing flows.
- Changes stay on the integration branch. No account migration, model default,
  prompt/history rewrite or release promotion accompanies these UI fixes.
- Behavior regressions were exercised red before the fixes. Final related UI
  suites pass **222 cases in 27 files**; preview/summary suites pass **90 cases in
  nine files**. Source/Electron/E2E typechecks, changed-file ESLint and the renderer
  build pass. Root static checks pass all **14 checks** with zero code-health
  findings after extracting gateway error handling and removing unreachable old
  overlay gates.
- Isolated Electron acceptance passes the three presentation flows (summary tabs,
  pause/continue and Settings entry) in **36 seconds**. The custom endpoint core
  flow also verifies real discovery, saved assignment, first/second turn, reload,
  transcript integrity and one live backend socket. These use synthetic
  development accounts and local mock providers. Connection-stage rendering was
  inspected at desktop and narrow widths in light/dark; it follows real progress
  and unmounts on connection. No paid inference is used.

## Composer continuation presentation follow-up

The later reference replaces the visible pause rows with one circular Play action
in the composer's existing primary slot. A paused reply retains its accessible
announcement without occupying visual space. The button uses Aino's shared action
palette and the approved Play triangle. Text and attachments retain the normal
Send path; queue editing, waiting cards and voice conversations keep their own
controls. The existing continuation was extracted to
`apps/desktop/src/app/chat/composer/hooks/use-task-continuation.ts`, preserving
owner/profile routing, exact tokens, synchronous duplicate protection and failed
submission recovery. Its subscription reads only that owner's pause state.

- Four primary-control regressions fail on the earlier implementation and pass
  with the new control. Related UI/continuation/protocol/draft suites pass **156
  tests in ten files**. Typechecks, changed-file ESLint and renderer build pass.
- Isolated Electron acceptance passes in **11 seconds**: stop the stream, wait
  for settlement, confirm no visible pause rows, type a new draft to restore
  Send, clear it to restore Play, then continue the original task. Desktop and
  compact screenshots verify the round action remains at the right edge.
  No renderer error or framework overlay appears; all account/model traffic is
  synthetic and local. Release remains on hold.

## Composer model stability and navigation typography

- Sending with Aino image generation enabled refreshes the shared model catalog.
  The composer previously treated its temporary `loading` phase as a loss of
  reasoning support, unmounting the effort control and shifting the model row.
  Presentation now retains the matching account/origin/revision's cached
  capabilities while refreshing. Request preparation still requires `ready`;
  refreshed capability changes and account changes remain authoritative.
- The real hook and model/effort controls reproduce the disappearing control on
  the base and keep the same DOM controls through a delayed refresh after the
  fix. Catalog tests also cover a changed account, origin, revision and stale
  response. Seven focused UI files pass **35 tests**.
- Navigation, session/project titles and the account name now use the shared
  14px UI role. Removed sidebar overrides that had reduced them to 12–13px;
  timestamps and supporting metadata keep their caption size.
- Chat Text Size was intentionally independent of whole-window zoom. Retained
  both controls and renamed the latter **Global UI Scale** in every locale,
  with explicit guidance for navigation/settings versus message/editor text.
  Existing saved preferences, setting IDs and deep links remain compatible.
- Real Electron typography acceptance fails on the base (13px navigation versus
  14px editor), then passes after the fix. It checks maximization, navigation,
  session/account text, independent 125% chat sizing, global 125% Electron zoom,
  reload persistence and compact-window editor bounds. The existing full
  pause/type/clear/continue acceptance also passes. No renderer errors appear.
- Typechecks, changed-file ESLint, renderer build and development main bundling
  pass. Validation uses a disposable local account and mock inference; the normal
  user's account, model preferences and API checkout are untouched. No release
  or version change is part of this follow-up.

## macOS close and reopen presentation

- Reproduced the red-close/Dock-reopen flicker in real Electron: a signed-in
  window painted the login form and resized `1180 → 340 → 1180` before returning
  to its conversation. The native close/recreate policy and saved bounds were
  correct; the new renderer treated unresolved identity as signed-out.
- AccountFlow now uses the shared PageLoader during initial identity recovery,
  without requesting compact login mode. Confirmed sign-out, reauthentication
  and initial failures keep their existing login/retry paths. A later login
  attempt keeps its form and second-factor inputs mounted.
- Native status publishes before the separate public login-options network
  request completes. Operation and revision fences prevent late refreshes or
  options responses from undoing a newer login, sign-out or reauthentication.
  Workspace reveal still waits for native bounds, including a changed action
  owner that already has a cached signed-in state.
- Regression tests were proven red before the fix. **53 renderer tests in seven
  files** and **20 Electron unit tests in three files** pass, covering initial
  restoration, offline identity, failed recovery/retry, input retention, owner
  changes and late async results. Typechecks, changed-file lint and build pass.
- The macOS Electron acceptance closes and reopens the workspace three times:
  each observes **zero login-form mutations**, width samples only `[1180]`,
  the same conversation route and its saved response, with no renderer errors.
  The fixture waits for its initial turn to finish and its session row to become
  visible before testing reopen. Browser plugin is unavailable; validation uses
  the repository's Electron Playwright harness and disposable local account.
- No native close/tray/background-work semantics, credentials, API checkout or
  release version changed. The integration branch remains on release hold.

## Validation boundary and release hold

- This verifies source integration on macOS ARM64, not a newly signed/notarized
  installer or an online auto-update. Packaged-candidate tests require an explicit
  new candidate and are skipped here. Windows/Linux host tests remain for their
  native CI lanes; case-sensitive filesystem-only tests are skipped on this
  case-insensitive APFS volume.
- No live production login, paid inference/payment, production CORS change,
  deployment, update-feed promotion or release publication was performed. The
  isolated API uses real handlers with synthetic accounts and upstream responses.
- Browser Aino calls depend on the external API CORS allowlist. Enabled CAPTCHA
  has no browser proof exchange yet and truthfully directs the user to native
  Aino. Browser login lasts for the tab session, requires HTTPS on remote hosts,
  and does not offer native diagnostics. Blocked payment popups surface an error
  while QR/order recovery remains available.
- Upstream's externally hosted plugin migrations retain their external install
  availability requirements. No replacement capability manager was introduced.
- The imported documentation workflow shortens old static asset retention from
  14 to two days to keep the Pages artifact deployable. That workflow was not
  run; an eventual deployment has the shorter recovery window for long-open tabs.
- Finish and retain the integration branch only. Main and published Aino versions
  remain unchanged until the user's separate release instruction.
