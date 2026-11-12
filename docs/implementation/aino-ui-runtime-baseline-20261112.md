# Aino desktop and runtime baseline before Hermes v0.23.1

This checkpoint preserves the accumulated Aino work before importing the next
upstream release. It starts from main `1a3cb06dd598b4087bcda0c22ac76d50fc62580d`,
which already contains Hermes v0.23.0 and the tool-panel lifecycle repairs.

## Behavior preserved

- Aino product identity is shared by Desktop and Python, including built-in
  help and a complete installed offline handbook. User-defined Bot identities,
  third-party provider names, licenses, `MEDIA:` cards, preview instructions,
  theme variables and compatibility identifiers keep their existing semantics.
- Aino-API conversation cloud sync is retired. Local history, attachments,
  account isolation and other platform APIs remain. Compatibility IPC returns
  an explicit disabled result and starts no background sync.
- Account switching selects the account's local workspace before loading its
  sessions. Device details use the machine name and stable installation ID;
  model selection and Bot creation do not mint another device authorization.
- New Bots inherit the saved default model across built-in, provider and custom
  routes. Session-specific overrides remain session-owned. Recovery UI clears
  resolved model failures without dropping history or drafts.
- The Bot navigation, account display, notifications, confirmation dialogs,
  inline recovery and collaboration capsule use Aino's current desktop layout
  and shared tokens. Notifications overlay their workspace without moving it.
- Delegated agents use readable names and avatars and open in the existing
  tabbed tools panel. Summary belongs to the conversation workspace.
- Panel and summary transitions preserve logical visibility and cancellation.
  Native browser and terminal hosts remain connected; horizontal panel motion
  keeps the guest viewport stable. Slot resize observation follows real sash
  and window changes, including returning to a resized background tab.

## Verification record

Completed before this document was written:

- Python: canonical `scripts/run_tests.sh`, 184 files, 1,756 passed, 36 skipped
  under the existing PM-managed Python 3.14 test environment.
- Additional native payload and installed product resources: 21 passed;
  session import/export and Relay compatibility: 17 passed.
- Renderer, Electron and E2E TypeScript checking passed.
- Summary ownership, legacy connection routing and notification cadence:
  40 targeted tests passed. The legacy owner route now retains its resolved
  local connection instead of falling back to ambient routing.
- Real development Desktop: repeated browser-panel open/close, native viewport
  recording and sash narrowing/restoring retained the guest and page state.

The complete desktop suite, final consolidated checks and CI are recorded below
when their final results are available. Earlier runs exposed incomplete brand
resources in isolated source fixtures, notification assertions that also matched
screen-reader announcements, and a panel-header focus issue. These runs are not
counted as successful acceptance.

Final checkpoint checks:

- `scripts/check`: all 14 checks passed, including zero blocking/advisory
  code-health findings. Desktop type checking and lint passed with no errors.
- Electron platform suite: 451 files passed, 11 environment-dependent files
  skipped; 4,389 cases passed and 66 skipped in one complete run.
- Final renderer suite: all 1,899 files and 15,613 cases passed in one run
  against the stable source after the Bot hydration repair.
- Real Electron acceptance: product identity across ordinary/Bot/group/child
  requests (2 cases), the full tabbed panel flow (12 cases), native compositor
  and panel motion (2 cases), and same-account relogin (1 case) passed. Native
  browser content keeps its instance, viewport and page state through motion.
- Explicit Bot opening now finishes hydration before background roster/reclaim
  refreshes can open the same session. Deferred activity remains available to
  the next poll. The race was reproduced before the fix; 123 related cases
  passed after it, including cold and already-fronted chats.
- Generated skill documentation was refreshed from the installed Aino help
  skill. Documentation link checks and the English Docusaurus build passed.
- Minimal installer/update source fixtures now include the real shared brand
  resource, matching production source checkouts. Seventeen related Python
  cases passed on macOS; Linux-only fresh-install cases are verified by CI.
- Built-in, official-provider and custom model inheritance each passed three
  consecutive real Electron/API runs, including actual provider responses.
- Nix's isolated desktop-entry generator now carries the shared identity
  module and brand data. Its generated launcher is checked against the shared
  brand and executable; isolated staging and 65 related Python cases passed.
  The full Nix build is verified on the Linux CI host.
- Sealed CLI and cold-runtime source fixtures also carry their real brand
  resources. Eight related cases passed; two Linux cases remain host-gated.
- Prompt snapshots now include the Aino guidance and tool schemas. Checkout
  paths are normalized only in snapshot output. Two snapshot cases passed;
  rendering from a second real checkout produced byte-identical output.

Remote CI results are tracked in the pull request before merge. No installation package
or production deployment is part of this checkpoint.

## Upgrade requirements

Import the exact stable Hermes v0.23.1 release while retaining the above Aino
behavior, account and billing authority. Integrate new runtime capabilities and
adapt new controls to the current Aino UI. Never restore retired cloud sync or
replace the tabbed panel, summary placement, palette, typography or layout with
upstream presentation. Keep this checkpoint separately reviewable and merged
before beginning the upstream import.
