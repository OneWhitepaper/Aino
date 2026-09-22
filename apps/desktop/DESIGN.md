# Desktop Design System

Conventions for the Electron desktop app (`apps/desktop`). Read this before
adding a component, overlay, or style. The rule of thumb: **one source per
concern, tokens over literals, flat over boxed.** If you reach for a raw color,
a one-off shadow, a bespoke button, or a hardcoded `px-*` on a control — stop,
there's already a primitive for it.

This file owns the visual and interaction contract. Read
[`AGENTS.md`](./AGENTS.md) for architecture, state, resolver, transport, and
testing rules.

This doc contains two kinds of content, maintained differently:

- **Principles** (flatness, intent, feedback, motion, cancellation) are durable.
  They hold as components come and go.
- **Named contracts** (tokens, `Button` variants, primitive names) are the
  design system's current API. They are maintained *with* the code: if you
  change a primitive, token, or variant, update its entry here **in the same
  change** — a stale name in this file is a bug, exactly like a stale type.

When a rule and the code disagree, fix whichever is wrong rather than forking a
one-off at the call site.

## Principles

1. **Flat, not boxed.** No card-in-card. Settings forms use outlined groups and
   fine row dividers to keep labels aligned with their values and controls.
   Group with whitespace and a single hairline, never nested rounded boxes.
2. **Borderless elevation for floating panels.** Overlays float on
   `shadow-nous` + a `--stroke-nous` hairline, not thick framed boxes. In-panel
   structure may use token hairlines sparingly.
3. **One primitive per concern.** One `Button`, one set of control variants,
   one `SearchField`, one `Loader`, one `ErrorState`. Migrate onto them; don't
   fork.
4. **Tokens, not literals.** Reference CSS vars (`--ui-*`, `--shadow-nous`,
   `--theme-*`), never raw hex / ad-hoc rgba in components.
5. **Style lives in the primitive.** Variants and sizes own padding, radius,
   color, chrome. Call sites pass a `variant`/`size`, not `className` overrides
   that re-specify those.
6. **Intent before automation.** Surface useful actions and previews, but do not
   open panes, move focus, or navigate because a tool happened to produce
   something.
7. **Immediate feedback.** Direct manipulation updates the view first. Network
   or disk persistence reconciles afterward and rolls back visibly on failure.

## Information architecture

- **Chat is the home surface.** The transcript and composer stay primary; tools,
  previews, files, review, and terminal complement the conversation.
- **Pages are durable destinations.** Chat, Settings, Skills, Messaging, and
  Artifacts remain in shell chrome. Do not hide a distinct product noun inside
  an unrelated page.
- **Route overlays are short tasks.** Command Center, Cron, Profiles, Agents,
  and Starmap render as `OverlayView` cards and return to the previous route on
  close. Settings is a full-page workspace with its own navigation and return
  affordance. Model/session pickers and dialogs layer above the current
  surface; they are not navigation stacks.
- **Panes are working context.** Preview, files, review, and terminal remain
  attached to the current task. Their state survives temporary hiding and chat
  switches where the underlying tool is meant to persist.
  Files, Summary and newly created terminals follow the last interacted chat
  tab, including split chats. Clicking a tool does not silently switch back to
  the main chat. Existing shells keep their processes and directories; a matching
  tab may be selected, never moved or recreated. Unscoped Review follows the same
  chat, while an explicitly opened repository stays pinned until another explicit
  review action. Source/profile ownership gates filesystem actions; delayed reads
  cannot paint or open files from a previous project or machine.
- **Summary is a persistent workspace card.** Its list icon precedes Terminal
  and the right-sidebar toggle. The titlebar button alone opens and closes it;
  outside clicks, Escape, conversation switches and opening other panes leave
  the choice intact. The card reserves a right-hand column, recentering the
  transcript and composer together within the remaining workspace. It scrolls
  independently and never mutates the user's saved tiling tree or remounts
  chat/terminal surfaces. Below 1024px, or when existing tracks cannot fit beside
  the card, it stacks beneath the workspace. The compact rail fits its content,
  capped at 40% of the workspace height so the composer remains usable. Opening and closing use
  a 200ms slide/resize transition, disabled under reduced motion. Its contents follow the selected
  conversation: an overview leads with the live turn state (turn ended never
  means task completed), followed by outputs, plans and execution details.
  Ordinary chat has a small neutral empty state and an Outputs affordance; real
  artifacts, sources, plans, subagents and background processes add their groups
  only when present. Inputs (attachments, links, loaded skills and external
  services) are separate from generated outputs. Resource lists start compact
  and expand in the card; images reuse the existing media resolver and files
  open through the existing preview path. The create affordance inserts an
  editable prompt into the composer, never sends one.
  Project chats add a final, collapsed environment group. Repository reads and
  Git actions mount only when its details are expanded. A non-Git directory is
  a valid project: it has no Git warning or retry. A clean repository is an empty
  result, not a failed request. Changes
  cover the whole working tree, including manual edits, and retain Review's
  staging/revert confirmation paths; commit and PR open the existing Review
  workflow. When the selected conversation's owner differs from the foreground
  filesystem connection, Git reads/actions stay unavailable until that owner
  is active; a same-named directory on another machine is never a substitute.
  Previews retain producer provenance: opening a reference file does not make
  it an output, and a later successful write promotes that existing preview.
  Runtime feeds resolve through the selected durable conversation's
  runtime binding. Persisted history uses the existing owner-scoped transcript
  API (including compressed history), refreshed on opening and turn boundaries,
  rather than scanning the transcript on every token. Finished plans/delegations
  remain readable after their live chips clear; a historical dispatch alone
  never claims a child is still running. Read failures offer retry, not a false
  empty result. System
  resources remain in Settings and are not displayed or polled by this card.
  Context usage lives beside the model in the composer: a neutral progress
  ring reveals usage on hover and the existing breakdown on click. It reads
  that composer's session and owner-routed `session.context_breakdown` request,
  refreshes when idle, and reflects the existing compaction state. Summary
  no longer fetches or duplicates those details.
  Diffs, source previews and terminals open beside the summary, without
  dismissing it. Settings temporarily covers the workspace without resetting
  the summary choice.
  Older saved layouts retire only the former Summary pane.
  This behavior draws on Codex's public
  [artifacts viewer](https://developers.openai.com/codex/artifacts-viewer),
  [repository review scopes](https://developers.openai.com/codex/code-review?surface=app)
  and [chat environments](https://developers.openai.com/codex/environments/git-worktrees).
  Summary reuses Aino's existing resource and activity data. For longer conversations,
  the overview also reads an independently persisted, language-scoped semantic
  summary of goals, completed work, findings and unresolved items. Generation runs
  only while the panel is open and the turn is idle, through the owning session's
  authenticated runtime and existing auxiliary model/billing path. Each update
  uses one model call with at most 24,000 serialized evidence characters and
  requests concise output through the provider-compatible auxiliary route.
  Long messages and tool outputs use excerpts; conversations
  that still exceed the budget retain the original request and recent content.
  The overview labels excerpted or recent coverage beside the update time,
  without claiming to cover omitted history. A saved summary remains readable
  while the agent is working. A new turn takes priority over generation;
  updates superseded by that turn leave the saved summary intact and do not
  persist a failed revision. The backend
  validates citations against visible durable history, including compacted rows,
  and refuses to publish a result if the conversation changed during generation.
  Identical revisions reuse the cached result; failed revisions require explicit
  retry. Short greetings do not invoke a model. Updates show their timestamp and
  stale state, and citation actions reveal the original message in its own pane.
  The summary never rewrites chat messages, system prompts or model context, and
  never triggers context compression. A configured independent summary model is
  available through the existing auxiliary-model settings.
- **Terminal is a bottom workspace.** The default docks it beneath chat while
  navigation and the file/review rails remain full-height. The titlebar toggle,
  palette and shortcut share pane visibility; hiding releases the panel's space
  without closing shells. Its own horizontal name tabs provide New, Close and
  Hide, so a lone terminal does not need a second zone header. Mixed zones keep
  their navigation strip. The old navigation-tab placement migrates once;
  subsequent custom terminal placement remains user-owned.
- **The file browser uses conversation chrome.** Its root directory keeps its
  original spelling in a neutral section label; file rows use the shared UI
  type scale, clear primary text, secondary icons and soft selection fills.
  The virtualizer owns row height, and nested names truncate within the pane.
  A strip containing Files uses neutral tabs without an accent underline,
  retaining the compact track used by minimization and layout editing. Tab
  faces mask filenames beneath the hover close chip, including under Glass;
  primary navigation and other editor strips retain their own geometry.
  Refresh and collapse actions remain discoverable, and the layout sash alone
  owns the pane boundary, including when the sidebar changes sides.
- **One action, one home.** A command may have keyboard, palette, and visible
  affordances, but they invoke the same action and state. Do not fork behavior
  per entry point.
- **Projects own workspace cwd.** Use Sidebar → Projects for local folders and
  worktrees; do not reintroduce a per-session/right-sidebar folder-picker flow.
  The sidebar lists only projects explicitly opened or created in Desktop,
  remembered per connection and profile. Discovery and saved registrations do
  not open projects. Closing a project removes it from this list, preserving
  its registration, files and conversations; its unpinned chats return to Recent.
  Project rows place More and New session icons after the name, in both the
  overview and entered project. Reveal them on row hover or keyboard focus;
  the entered project has no separate New session row. The compose icon reuses
  the main navigation artwork and the existing project-scoped creation action.
  Project menus own folder membership and the primary folder. Removing a project
  or folder registration never deletes files or conversation history. Profile
  management lives in Sidebar → Workspaces. Selecting a row only previews its
  configuration; switching is an explicit action. The page reuses profile
  creation, cloning, rename/delete and SOUL editing,
  with profile-scoped model and capability controls. All profiles is a browse
  scope, and opening a folder resolves to the active writable profile.
- **Sidebar identity is the signed-in account.** Its circular avatar and name
  open Settings → My account. Use the account display name, falling back to its
  login identifier; workspace/profile selection must not change this identity.
  The navigation shell owns this footer, so Sessions and Agent Hub keep the same
  account and settings entry, including in the narrow-window sidebar overlay.
  My account edits the nickname through the account backend. The sidebar follows
  the confirmed account state; a failed save keeps the prior name and editable draft.
- **Conversation navigation has three sections:** Pinned appears only when it
  contains a session; Projects remains present even when empty; Recent lists
  ordinary conversations. Pinned and project conversations do not repeat in
  Recent. Project membership comes from the backend tree with live overlays;
  unclassified sessions stay reachable while that tree loads. New Project and
  Open Folder stay visible even when Projects is collapsed. Creating/opening a
  project starts a draft in its primary folder; the main New Session action
  starts an ordinary draft without inheriting the previously selected project.
  Project menus, worktree lanes, session ordering, filters and split drags keep
  their existing action paths. Messaging and scheduled jobs retain their own
  sections below Recent.
  Section collapse choices survive restarts. The Recent section's options menu
  owns Import session; primary navigation stays compact so projects remain in view.
  A resolved empty project list stays visible during focus and session refreshes.
  Loading placeholders belong to the first read of a gateway/profile scope, so
  background refreshes never push the Recent list down and back up.

Profile icons and condensed profile rows offer **Open in new window** and
**Set as default** in their existing context menus. Opening a profile creates a
full peer window without switching the source window. The desktop default
applies at startup and to generic new chats; explicit profile/project actions
and profile-specific windows keep their own destinations. Changing the default
does not move existing sessions or replace the active conversation.
Ordinary **New Window** (`⌘⇧N` / `Ctrl+Shift+N`) inherits its opener's device and
profile only at startup, not as a window-specific default. Later device/profile
selections remain authoritative for new chats unless a desktop default is set.

Navigation must preserve context. A background session finishing, a tool result
arriving, or a project refresh may update badges and cached data; it must not
replace the foreground transcript or steal focus.

## Surfaces & elevation

The approved Aino conversation is the visual anchor for **all** desktop-owned
surfaces: routes, Settings, dialogs, menus, auxiliary windows, lifecycle states,
panes and bundled plugins. `src/styles/aino-theme.css` defines the shared neutral
surface roles at `:root`, so body portals and independent renderers inherit them
without a page-specific opt-in. ThemeProvider owns the fixed neutral Aino (`mono`)
palette and font tokens. Appearance offers Light, Dark and System; theme cards,
theme installation, palette commands and desktop `/skin` switching are retired.
Legacy palette assignments and backend skin events cannot recolor the desktop.
Brightness remains per profile and follows peer windows; CLI/TUI skins, typography,
zoom and native Glass keep their independent settings. Stored theme assets are not
deleted when upgrading.

Gatewayless auxiliary renderers (Quick Entry, pet overlay, wake indicator, intro reveal) mount
`ThemeProvider auxiliary`. This presentation-only mode follows the remembered
active profile and peer appearance storage events, but never publishes gateway
profile authority or Electron native-theme ownership.

The browser annotation card is host chrome and follows the shared panel, text,
and action roles. Selection outlines and markers drawn inside guest pages keep
their explicit review colors because those documents do not load the desktop theme.
Intro reveal shares this chrome and the saved UI typography; its animated canvas
retains its own media colors.

Settings uses `SettingsGroup` from `app/settings/primitives.tsx` for related
form rows: a single neutral one-pixel outline, 8px corners, no shadow, and
16px horizontal insets. Keep section titles outside the outline. `ListRow`
owns `data-settings-row`; custom row wrappers use the same marker when they
include an inline editor. Only sibling rows inside a group receive dividers,
so descriptions, status messages and expanded controls stay with their row.
Do not add another group around already framed tools or lists. Grouped rows
use a 36rem content-width breakpoint for the label/control split, accounting
for the added insets; narrower groups stack. Use shared stroke tokens in
both brightness modes, without flattening native Glass surfaces.

My account's usage history queries the full ledger by date range, model and
call purpose. Dates use the displayed local timezone. Bordered rows show exact
request time, model, purpose, authoritative decimal cost and settlement status;
expanded details reuse the copy control for correlation IDs and distinguish
unreported token counts from zero. Numbered pagination, total count, page size
and direct page entry reuse the existing pagination primitives. Applying filters
resets to the first page; stale account/query responses never replace current
results. Chat reply receipts retain their compact layout. Purpose filters follow
the server's advertised supported values; old servers retain the legacy set.
Historical auxiliary calls without finer attribution stay visibly unclassified.

The approved v2 light palette is a `#fcfcfc` canvas, `#f3f3f4` sidebar,
`#ffffff` paper, and `#f8f9fa` field/header fill. Primary, secondary and supporting
ink are `#303236`, `#61666d` and `#858a92`; seams use `#e7e8ea`, control outlines
use `#e1e4e8`, and selection uses `#e5e6e8`. These values live in the derived
`--ui-*` roles, not ThemeProvider's inline seeds. Landing and sidebar colors alias
those same roles, so dark appearance and native Glass follow the existing surface
resolution. Actions are graphite; links and focus retain their semantic accent.
Semantic error/success/warning, syntax and diff colors retain their meaning. Use the normal
UI font for labels; reserve monospace for code, commands, paths and numeric data.

Floating panels (base `Dialog`, route overlays, boot/install/update surfaces,
model-picker, onboarding, prompt overlays, notifications) use:

```
shadow-nous           /* downward-weighted, layered contact→ambient falloff */
border-(--stroke-nous) /* currentColor hairline, theme-adaptive */
```

`--shadow-nous` lives in `src/styles.css`; `--stroke-nous` is the shared semantic
hairline in `src/styles/aino-theme.css`. Tune those tokens and every peer inherits.
Don't add per-overlay `shadow-[…]` or `border-(--ui-stroke-secondary)`
one-offs; if elevation needs to change, change the token.

Menus, selects, dialogs, sheets and popovers share the same `shadow-nous` +
`--stroke-nous` treatment and 20px panel radius (sheets round their exposed edge).
Drag affordances may use tokenized dashed targets and local blur. These are semantic surface classes, not licenses
for call-site shadow or border inventions.

`PopoverContent variant="card"` provides a 320px floating card with 20px corners,
zero outer padding and the shared `shadow-nous` / `--stroke-nous` elevation.
Its content owns internal spacing and viewport limits. `showArrow={false}` omits
the pointer for toolbar cards; other popovers keep their existing arrow.
The summary rail reuses its paper surface through `CARD_SURFACE_CLASS` in
`src/components/ui/card-surface.ts`, without popover dismissal or focus capture.

**Queued cards:** `CardStack` (`src/components/ui/card-stack.tsx`) consumes a live,
keyed list, retaining the current item when more arrive. Inline and floating
approvals and both toast placements share its gesture handling and geometry.
The Cursor-reference treatment uses one 96%-scale silhouette 7px above the
front, 220ms promotion, and 180ms upward clearance; no rotation or lateral throw
on button/keyboard decisions. Consumers supply the existing surface tokens and
own the exact-request response. Gestures never grant approval. Departing cards
are immediately inert; toasts can expand to the full live list. One persistent
transcript-level host owns approvals, independent of tool rows and assistant
message boundaries. Prepared approvals can precede tool.start: execution must
not relocate or remount the stack. While approvals remain, a real activity line
above the cards changes from awaiting approval to current-turn command status;
represented execution rows appear only when explicitly expanded. Empty text
continuations must not introduce paragraph gaps. Keep inline approvals beside
the conversation and let genuine content scroll normally; do not inject padding
or write scroll offsets to pin the decision. Preview this order with delayed
start and completion events, not pre-created tool rows. Final approval removal
retires both the painted card and its measured layout footprint; restoring tool
rows must not insert their full height before the outgoing stack can settle.
No completion callback may clear the measurement of a newly arrived card.
Reduced motion settles immediately without retaining empty clearance.

## Window glass

Glass defaults to **29% Tint, Sidebar only** in both light and dark appearances.
Fade defaults to zero so the content column and text stay opaque. Native frost
keeps its platform/appearance defaults. Explicitly saved settings take precedence;
changing defaults must not overwrite a user's existing choices. The shared
`apps/shared/src/translucency.ts` resolver owns these defaults for both the
renderer and Electron's first window paint.

## Stroke & color tokens

| Token | Use |
| --- | --- |
| `--ui-stroke-primary…quaternary` | hairlines, in descending strength |
| `--ui-stroke-tertiary` | the default in-panel divider / list hairline — and every bordered surface in the transcript |
| `--stroke-nous` | the overlay hairline (pairs with `shadow-nous`) |
| `--ui-text-primary / -secondary / -tertiary` | text hierarchy |
| `--ui-bg-quaternary` | soft control fill (secondary button) |
| `--ui-widget-surface-background` | fill for inline chat widgets (`WIDGET_SHELL_CLASS`) |
| `--chrome-action-hover` | hover fill for quiet controls |
| `--theme-primary`, `--ui-accent` | brand/accent |
| `--aino-action-bg / -fg / -hover` | graphite primary action and contrast-safe inverse; shared by button, switch and checkbox |
| `--aino-radius-control / -row / -panel` | 10px controls and selected rows, 20px floating panels |
| `--aino-text-caption / -ui / -body / -title` | 12 / 13 / 14 / 15px type roles; page-specific headings can step up |
| `--aino-surface-*`, `--aino-scrim`, `--aino-focus-ring` | shared paper, rail, strokes, state fills, backdrop and input focus |
| `--aino-landing-*`, `--shadow-aino-landing-composer` | home/sidebar aliases of the shared semantic roles and `shadow-nous`; no independent light or dark palette |

Never hardcode `border-gray-*`, `bg-white`, `text-black`, etc. The white tile in
`BrandMark` is the one sanctioned literal (the mark needs a fixed backdrop).

## Buttons — one component

`src/components/ui/button.tsx` is the single source. Pick a `variant` + `size`;
do **not** pass `h-*`, `px-*`, `py-*`, or icon-size overrides.

**Variants:** `default` (primary), `destructive`, `secondary` (soft fill —
the default non-primary look), `outline` (transparent + 1px inset ring, no
fill/shadow), `ghost`, `floating` (a control loose from any surface — opaque
popover fill + shared elevation, hover lifts the glyph only), `link`, `text`
(boxless quiet inline — "Cancel", "Clear"), `textStrong` (bold underlined
inline affordance — "Change", "Open logs"), `titlebar-popover` (quiet toolbar
trigger with a soft open fill; `icon-titlebar` uses the shared control radius).
`grip` is the quiet, fill-free drawer handle; pair it with size `grip` for a
48×16 hit area around a small horizontal ridge.

**Sizes:** `default`, `xs`, `sm`, `lg`, `inline` (flush, zero box — for buttons
that sit inside a heading/sentence; replaces `h-auto px-0 py-0`), `micro`
(status-stack/table-footers), and the icon family `icon` / `icon-xs` /
`icon-sm` / `icon-lg` / `icon-titlebar`.

**Tooltips only when hover teaches something new.** `<Tip>` is for discovery,
not a tax on every icon. Ask: does hover reveal something the user cannot
already see or infer? If not, skip the tip; keep an `aria-label` for a11y.

Tip unlabeled chrome when the job (or a keybind / truncated path / host /
other detail) is not already on screen — toolbar / titlebar / statusbar icons,
`TipKeybindLabel` shortcuts, ownership chips, unlabeled icon grids.

`Tip variant="card"` is a rounded, theme-aware paper surface for multi-line
informational previews, such as context usage. It keeps the standard hover
delay and never takes focus; ordinary tooltips retain their inverse inline
treatment with the shared system-sans caption type role.

Do **not** tip:

- Menu triggers (kebabs / ⋯ / `ActionsMenu` / `DropdownMenuTrigger`) — the
  affordance is "open menu"; verbs live in the menu. Never tip
  `"Actions for ${row title}"` / `"Project actions"` / `"Actions"`.
- Close / dismiss X buttons — the glyph is the label (`aria-label` only).
- Controls whose visible label already says what the tip would ("click to…",
  paraphrases of the same words, timer labels restating "Running").

Never use native HTML `title=` on buttons — unstyled, ~500ms OS delay, clashes
with the themed `Tip`. `src/components/ui/__tests__/no-native-title.test.ts`
fails on any `<button>` / `<Button>` that still carries `title=`.

**Tooltip timing.** A hover is not a click — the cursor crosses triggers on
the way somewhere else. `Tip` waits 200ms before the first open so a sweep
does not flash a trail. After a tip has opened the page is warm: the next
trigger within 300ms opens instantly. The cooldown starts on close, so a
hover a second later waits again. Once triggered, entrance has no animation.
Exit fades over 100ms and moves 0.125rem toward the anchor; reduced motion
disables the exit animation. `OverflowTip` stays on its own longer delay
(list titles must not trail while scanning). Bubbles use a 0.25rem radius.

**Tooltip placement.** Choose intent through `placement`: `control` above (default), `toolbar` below, `row` to the right, and `left-rail` / `right-rail` inward. Explicit `side` and `align` override the preference. Radix flips and shifts for collisions, keeps the arrow attached, and hides detached triggers. Controls and toolbars use their owning pane as a boundary; row descriptions and rails may extend into the window. Use `boundary="viewport"` for an intentional escape. Short labels size to content; descriptions wrap within 24rem and the available space, in one rounded bubble.

**Slash descriptions.** Keep autocomplete rows single-line and ellipsized, but reveal the complete catalog description to the right of the hovered row. Use the shared bounded tooltip, collision padding, and word wrapping; it must not intercept row selection. Catalog and completion producers preserve the full author-supplied description.

**Model search.** Model filters and their highlighted labels treat hyphens, dots, underscores and spaces equivalently. Preserve original label spelling inside marks. The shared highlighter remains literal for other surfaces such as the command palette; model callers explicitly opt in. Model identifier search does not use dictionary spellcheck.

**Keybind hints in tooltips.** On a tipped button bound to a rebindable hotkey,
use `<TipKeybindLabel actionId="..." />` — it reads the i18n label and the
current combo from `$bindings`. Pass `text={...}` only when the label is
context-dependent (e.g. "Show" / "Hide"). Never hardcode combos; always use
`useKeybindHint` or `TipKeybindLabel`.

Notes:
- Text and icon buttons use the shared 10px control radius; text sizes use padding
  + line-height (no fixed heights). Boxless text/link actions have no radius.
  Primary actions use `--aino-action-*`, not the link accent.
- SVGs inherit `size-3.5` (`size-3` at `xs`). Don't re-set icon size.
- Polymorph with `asChild` when the button must render as a link/Slot.

## Badges — one component

`src/components/ui/badge.tsx`. Variants: `default` (neutral soft fill), `muted`,
`warn`, `destructive`, `outline`, `solid` (primary fill — icon-corner counts).
Sizes: `default`, `xs`, `overlay` (titlebar glyph counts).

## Context-sensitive dialogs

Sudo password dialogs keep the backdrop unblurred (`DialogContent`'s
`blurBackdrop={false}`) and show the complete, selectable command before the
password field. Long commands wrap and scroll; missing backend context is
explicit, never inferred from another tool row. Other dialogs retain the shared
blurred backdrop.

## Form controls

- **`controlVariants`** (`src/components/ui/control.ts`) is the shared shape for
  `Input` / `Textarea` / `SelectTrigger`: 10px corners, 13px normal UI text and
  padding-driven size. New text-entry controls compose it. Fields have neutral
  fill/hairlines, accent-only focus and a semantic invalid state; grouped fields
  inherit the same font size as bare controls. No page-specific control overrides.
- **`SearchField`** — borderless, underline-on-focus, auto-width. The only
  search input. Don't build boxed search bars; don't wrap it in a bordered tile.
  Empty lists hide their search field.
- **`SegmentedControl`** — the choice control for small mutually-exclusive sets
  (color mode, tool-call display, usage period). Replaces radio piles and
  pill rows. The neutral track and active paper option share the control radius,
  with the same keyboard focus outline as buttons. Menu selection rows use the
  10px row radius; normal route tabs use a soft neutral selection fill.
- **`Switch`** (`size="xs"`) — bare, with `aria-label`. No bordered text wrapper.
- **`FanMenu`** (`src/components/ui/fan-menu.tsx`) — one hub control that
  fans sibling toggles out on hover: `direction` `vertical` | `horizontal`
  (split around the hub) | `arc`. Discs are `Button` `floating` off /
  `default` on; tips face outside the fan according to its geometry. Use it where a row of rarely
  touched toggles is costing input width (the composer's voice controls).

## Layout

- **Navigation rail:** new layouts open at 264px. Existing saved widths remain
  authoritative, and the supported 245px minimum is unchanged. A quiet gray rail
  continues into its portion of the native titlebar, with one continuous hairline at the content boundary.
  The tree sash owns the divider and its resize target; panes do not add
  edge borders or shadows. Titlebar-local geometry follows resizing, hiding
  and side swaps without per-frame root style invalidation. Glass retains
  the body field painter plus one subtle rail-tone layer, not stacked fills.
  Glass sidebar scope follows the foreground rail: Settings owns its boundary
  while open, and its narrow dropdown leaves no vertical glass strip.
  Sidebar Glass follows the rail's physical left and right bounds, including
  when a swap places it between chat and Summary. Chat and Summary keep their
  opaque fields on either side; moving a rail never leaves its old tint behind.
  Swapping sides changes track order without moving their DOM hosts, preserving
  chat subscriptions, drafts and embedded documents. Keyboard and assistive
  reading order follow the visual flex order; sashes resolve neighbors by track
  identity rather than DOM position.
  Navigation uses bare line icons, primary-ink labels, smaller section labels
  and soft neutral hover/selection fills without inset outlines.
- **Primary chat header:** the active conversation title and its existing
  session menu share the window titlebar with session search. Slots shrink
  within the chat pane and native/window-tool boundaries; long titles ellipsize and search
  results open below the field without resizing the chat. Do not reserve a
  second header row for a session-only primary group. Mixed pane tabs,
  secondary chat splits and layout edit mode retain their local strips;
  Settings and auxiliary windows never borrow the primary window's header.
- **Gutters:** `PAGE_INSET_X` (`src/app/layout-constants.ts`) for page side
  padding; `PAGE_INSET_NEG_X` to bleed a child to the edge. Don't hardcode
  `px-6`/`px-8` on pages.
- **Master/detail overlays:** `OverlaySplitLayout` + `OverlaySidebar` /
  `OverlayMain`. Cron, profiles, etc. ride this — don't rebuild a titlebar
  shell.
- **Settings subpages:** `OverlayNav` keeps navigation and disclosure separate:
  labels navigate; the shared `DisclosureCaret` button opens a branch without
  changing the page. Active paths reveal automatically, inactive paths stay
  folded unless manually opened. General comes first wherever present; parent
  labels and parent URLs open the first ordered subpage, never an overview or
  the last visited child. Explicit child links retain their destination;
  every parent and child uses the same Settings breadcrumb, without a duplicate
  icon-and-title heading. Page-level `SectionHeading page` retains actions and
  counts under breadcrumb-owned chrome; embedded callers keep their headings.
  Narrow windows keep every destination available in the shared navigation dropdown.
  Search and saved field links resolve to the owning child before highlighting.
- **Rows:** `ListRow` (settings `primitives.tsx`) for label/description/action
  rows. Flat, flush-left; no per-row indentation that fights flush headers.
- **No dividers between rows** unless the list genuinely needs them; prefer
  spacing. When you do need one, it's a single `--ui-stroke-tertiary` hairline.

## Panel titlebars

Top-edge panels extend into the native titlebar band. Their tab strips remain
inside their own zones so tab drops, focus, and split boundaries use the same
geometry. Panels without room beside the measured window controls place their
tabs on a full-width row below the controls. Minimized row groups use vertical
restore rails, including groups with multiple tabs. Sidebar buttons and shortcuts
restore minimized or fully hidden side groups without changing the selected tab.
Lower panels keep local headers. Empty header space moves the window;
tabs and actions remain no-drag, with native-control space reserved from the
existing traffic-light and Window Controls Overlay measurements.

The left cluster shows sidebar, settings, layout editor, and HUD controls. Flip
and the right-sidebar toggle sit on the right; haptics remain in settings.
Holding Cmd (Ctrl off macOS) reveals small slot numbers over the target strip's
status dots after 400ms, without changing tab widths. Hints follow the same
binding and hovered/focused-zone resolver as the number shortcuts.

Tab close buttons fade the label with a content mask, not a painted gradient.
The tab reads its surface token directly so glass tint is painted only once.

Sticky user messages clip covered scrolling content, including the gap above
them. Their wrappers stay unpainted; only the rounded user bubble owns a fill.
Clipping follows the pinned prompt and its live height without changing layout,
so glass and message-bubble transparency do not reveal scrolling text.

## Feedback & empty/error/loading states

- **Progress:** `Progress shape="ring"` reuses the progress primitive's clamped
  value and accessible range for compact meters. Its `sm` / default / `lg`
  sizes are 14 / 16 / 20px. Indeterminate animated rings respect reduced motion;
  the existing bar shape remains the default.

- **Loading:** `Loader` (`src/components/ui/loader.tsx`) — animated math/ascii
  curves (`lemniscate-bloom` for long ops). Never ship the literal text
  "Loading…".
- **Errors:** `ErrorState` + the canonical `ErrorIcon` (no bg chip). One look
  for the React boundary, in-dialog errors, and the boot-failure banner. Pass
  nodes for title/description so Radix `DialogTitle`/`Description` can flow
  through for a11y.
- **Logs:** `LogView` — no bg, hairline border, tight padding, small mono.
  Every place we surface raw logs uses it.
- **Empty:** `EmptyState` for plain page bodies; `PanelEmpty` for overlay
  master/detail empties with an icon and action. Don't hand-roll a third
  centered empty.
- **Confirmation:** `ConfirmDialog` is the only way we ask "are you sure". It
  opens focused on Confirm, so `Enter` confirms and `Esc` cancels, and it owns
  the pending → done → close beat and the inline error — a call site passes an
  async `onConfirm` and nothing else. A third way out (e.g. "Remove from
  sidebar" beside "Delete worktree") goes in the one `secondaryAction` slot.
  Never `window.confirm`: it's an unstyled blocking Chromium modal. A handler
  that wants the answer inline instead of a mounted dialog calls `confirm()`
  from `src/store/confirm.ts`, which renders this same primitive through the
  single `ConfirmHost` at the shell — the way `notify()` backs notifications.

## Chat, tools & boot surfaces

- The transcript and composer are built on `@assistant-ui/react`. Extend the
  existing components under `src/components/assistant-ui` and
  `src/app/chat/composer`; do not fork a second markdown, message, tool-call, or
  approval renderer for one feature.
- Conversation thinking is a compact disclosure row without a full-width
  divider. The turn pair owns the user-to-assistant gap. The reply footer
  appears only after its turn stops running, including gaps
  between text and tool calls. Pending footers reserve their layout space but
  remain hidden and inert; earlier completed replies keep their controls.
  The conversation composer starts compact and grows with its input; dictation stays inline,
  while spoken replies, wake-word controls and voice conversation share the
  voice menu. Recording/stop state stays visible, and Send keeps its place.
  Home and conversation composers share `--shadow-aino-landing-composer` so
  sending a message does not introduce a heavier floating surface.
  The home surface keeps its brand and quick tasks around the same composer:
  the resolved model name, project selector, attachment menu, approval mode,
  voice menu and send controls do not fork by home/conversation layout. A
  default model remains visible by name, and projects have one entry at the
  top of the input instead of a second fixed workspace button below it.
  The v2 home order is title and subtitle → project selector above the input →
  composer controls → the four existing quick tasks. The centered composition
  caps at 916px; the composer uses 22px corners, and quick tasks use 15px corners.
  The reserved slot and actual composer share one height, and the editor scrolls
  above its controls for long drafts. Task columns respond to the available chat
  pane width, and short windows use a more compact composer and spacing. The serif `AINO AGENT` heading is the only serif UI treatment.
  No decorative logo appears above it, and no duplicate app identity is added
  above the sidebar's titlebar → Sessions/Agent Hub switch → navigation ordering.
  Existing routes, section order, dynamic account/model/copy and action paths stay
  unchanged. Avatars, radios and send controls remain circular; compact checkboxes
  retain their intentional small square geometry.
  Home subtitles reuse the existing locale/personality copy pool and fresh-chat
  seed, staying stable on ordinary rerenders without a model request. They wrap
  to the available chat width, including narrow panes in wide windows. Locales
  without a copy pool retain their translated subtitle. Quick tasks keep their
  existing action paths.
- The main window's conversation heading and status dot stay hidden on the
  blank home surface and while a draft is unsent, including a draft tab promoted
  into the primary group. Sending its first turn reveals the heading; opening
  history shows its title even while the transcript loads. Multi-pane tab strips,
  secondary splits and layout edit mode retain draft previews and navigation handles.
  Long titles truncate within the left titlebar column, and the session search
  stays centered in the usable titlebar area. `PaneTabLabel` can opt into the
  shared overflow-only tooltip through `overflowLabel` for full title discovery.
- The composer resolves its folder against the sidebar project tree before showing branch and change
  totals. A backend working directory alone is not a project selection. Ordinary
  chats offer Select project. An unsent draft keeps its text and attachments when
  selecting, opening, or creating a project from the composer. Locally created
  empty tabs use the same rule; cold historical sessions are not empty drafts.
  Once sent in a project, the menu offers only that conversation's directory
  actions and a new chat in the same directory; it never lists unrelated projects
  or global create/open-project actions. Projectless chats retain project selection,
  which starts a separate chat after sending and never changes the original cwd.
  Restored chats may use their saved directory for the menu while runtime cwd is
  unavailable; Git status and actions still require a live cwd. Directory actions
  require the conversation to belong to the current source. Delayed pickers cannot
  retarget a different draft, profile, or source. Change totals still open the current workspace's review
  pane, and projects without git retain their project entry. The project menu
  owns directory details and Copy path / Reveal in file manager / Reveal in sidebar;
  it uses that composer's directory, never an incidental global backend cwd.
  A visible work-location menu beside the project name distinguishes the primary
  checkout from an isolated Worktree, using the existing Git worktree list and
  branch status rather than a saved mode flag. The menu reuses the shared creation
  dialog and draft-selection flow: unsent drafts retain text and attachments,
  while sent conversations open a fresh chat. Ordinary folders require no Git
  initialization. Remote primary checkouts say Project directory, not Local;
  a foreign conversation cannot create or select paths on the foreground machine.
- Workspace approval mode sits beside the attachment menu on the composer's
  left, with its menu opening upward from that edge. It uses the existing
  profile-wide setting and authoritative rollback on save failure.
  Narrow composers reduce it to an accessible icon before dropping secondary
  controls at the smallest size. There is no bottom statusbar or visibility
  toggle. Per-reply diagnostics are quiet, wrapping text beneath the answer;
  expandable details distinguish session elapsed time from reply duration.
  Only measured data is shown, with new reply metrics persisted as display
  metadata, never injected into model context. System resources live in Settings
  and poll only while viewed. Webhooks open from Gateway settings, subtask
  monitoring from Agent Hub; scheduled jobs and terminal keep their navigation.
  Versions and updates live in Settings.
- **Inline widgets** — a tool result that renders as a panel the user reads or
  acts on (clarify, artifact card) wears `WIDGET_SHELL_CLASS`
  (`src/components/chat/widget-shell.ts`): shared radius, the
  `--ui-widget-surface-background` fill, no border. Its actions sit *outside*
  the panel, below it. Don't give one widget its own radius or fill.
- Bordered surfaces in the transcript (tables, fences, callouts, attachments)
  use `--ui-stroke-tertiary`. Not `border-border` — that's the app-wide
  default and reads too hot against the thread.
- Interactive directive chips in the composer expose their action on hover.
  The action stays visible for a 500ms grace period while the pointer crosses
  from the chip to the floating pill; leaving both dismisses it.
- A tool result may expose an inline action that opens a preview. It must not
  open the rail automatically.
- Tool rows reserve destructive red for explicit failures. Missing read paths and
  ambiguous exit-1 results use neutral notices, with details still available.
  Errors described inside returned data are not tool failures. Expanded failures
  show the actual explanation; supporting output keeps its normal text color.
- Nested transcript scrollers keep their height caps and hand vertical scrolling
  back to the thread at either edge (`overscroll-behavior-y: auto`), even when
  their content fits. Only the outer thread contains vertical overscroll;
  horizontal code/output boundaries may remain contained. Thinking previews
  follow new tokens only while near the bottom, preserving the user's reading
  position until they scroll back down.
- Composer status groups start collapsed except todos. Progress updates and queue
  pause/resume preserve the user's disclosure choice. Error banners meet the
  stack's top edge without a blank padding strip. File and preview links remain
  visible at the bottom of the stack, below the queue and all status groups.
  A centered ridge on the composer's top edge hides/reveals the entire stack,
  including the git row, with a short downward/upward drawer slide. Its choice
  persists per conversation and owner, not globally. Hidden sections stay
  mounted but inert so their disclosure choices survive; reduced motion is instant.
- Popping out a composer makes it the window's only visible composer. It keeps
  its viewport placement while hover or keyboard focus selects a chat pane;
  moving back into the editor retains that recipient. Drafts, attachments and
  queues stay session-owned. Docking restores the individual pane composers.
  In either placement, moving into a chat pane gives its editor typing focus
  immediately and preserves its caret. Layout-only hover events and delayed
  focus callbacks cannot replace that choice, and a live transcript selection
  is never cleared by focus-follow. Movement within the same pane
  must not flush React; deliberate Tab navigation and clicked controls still work.
  An inline message edit is a typing target of its own: opening one keeps focus
  in the edit editor, and neither its mount-time focus nor mouse movement while
  it is open hands the caret back to the pane composer.
  Active dictation or voice conversation pins the recipient until capture ends,
  keeping the microphone's stop controls and shortcut attached to its owner.
- Status-stack rows use `StatusRow` with a leading `dismiss` action, a state
  icon and optional trailing actions. `StatusDismissButton` owns the Codicon
  close button for previews, background tasks and queued prompts; do not swap
  it for a trash icon or a CSS glyph. Icons and controls align to the first text
  line, including messages with attachment metadata.
- `status-stack.css` owns the shared columns and `0.25rem` nesting step. Rows
  own their padding and full-width hover fill. `StatusControlRow` uses the same
  columns for goal/loop/heartbeat details; `StatusPendingIcon` supplies the
  dashed marker for tasks and criteria. The first row keeps its normal padding;
  the stack adds no extra top inset.
- Keep the rounded status card stationary, with the bounded scroll viewport
  inside it. The outer scroll boundary uses `overscroll-behavior-y: contain`;
  nested rosters and transcripts use `auto` so wheel input can hand off at an
  edge without trapping it or scrolling the chat behind the stack.
- Install, onboarding, connecting, boot failure, and reauthentication are
  distinct states with shared visual primitives. Preserve their recovery
  semantics when unifying appearance.
- Quick Entry, HUD, pet and wake windows use the same font/control tokens while
  their native host stays transparent. HUD keeps its reveal/hold/click-through
  behavior; its reading panel and user bubbles use the conversation palette,
  without forcing one foreground onto code, errors, or approval actions.
- Terminals/editors, user artifacts, external sites and cross-origin Skills Hub
  contents are content boundaries. Unify all Aino-owned chrome, controls and
  loading/error states around them; preserve external content and semantic output.
- Respect `AppShell` overlay ownership. Persistent terminal/content layers,
  route overlays, dialogs, and boot surfaces must not compete through ad-hoc
  z-index literals. Pick a rung of the ladder in `styles.css` instead —
  `--z-modal-backdrop` / `--z-modal` / `--z-modal-popover`, `--z-over-modal`
  (toasts, tooltips, command surfaces) and `--z-over-modal-content`,
  `--z-switcher-backdrop` / `--z-switcher`, then the boot chain
  `--z-connecting` → `--z-onboarding` → `--z-setup` → `--z-crash`. Plain
  `z-10`/`z-20` are still right for stacking *within* one component.

## Iconography & brand

- **Tabler** is the default component/chrome set. Import its curated aliases and
  `iconSize` scale from `src/lib/icons.ts`; do not import icon packages directly
  in feature code.
- **`Codicon`** is the compact editor/tool/status vocabulary. Use
  `src/components/ui/codicon.tsx`, including `codiconIcon()` where a
  Tabler-shaped component is required.
- Pick the vocabulary by semantic context and reuse the existing icon for an
  action. Do not introduce a third icon set or mix styles within one control
  group.
- **`BrandMark`** (`src/components/brand-mark.tsx`) is the Aino brand glyph — a
  small vector mark, softly rounded and identical in light/dark. Use it for
  explicit brand moments outside the home headline and sidebar top; those two
  surfaces have no decorative app glyph. Do not reintroduce star/sparkle icons.
- Account sign-in retains its existing `assets/aino-account/logo.png` artwork
  and compact, centered layout with pill-shaped fields and actions. The home
  and sidebar glyph removal does not apply to sign-in; its scoped CSS shares
  the app's color tokens without replacing that approved layout.

## Motion

- Visible windows keep animating when another app takes focus. Hidden/minimized
  windows and inactive panes may pause; background polling stays focus-gated.
- Animated integer counts reuse `AnimatedInt` in `src/components/ui/diff-count.tsx`.
  Its spring updates the DOM directly without per-frame React renders.
- Quick, functional transitions (~100ms on controls). Respect
  `prefers-reduced-motion` for anything beyond a fade.
- Choreographed exits (e.g. onboarding's "matrix" fade-down) stagger per-element
  then settle the surface — the outer container's fade is *delayed* so it
  doesn't swallow the inner animation. Don't let a global fade race the detail.
- Motion follows state; it never delays state. Selection, drag targets, cancel,
  and pressed feedback paint in the current frame.
- Do not animate layout geometry with `transition-all` on a hot interaction.
  Name the properties, avoid backdrop-filter repaints during movement, and
  remove animation before masking a performance problem.

## Direct manipulation & performance

The app should feel instant under real load — long transcripts, several panes,
live streams. Design toward that:

- Direct manipulation paints first; persistence reconciles after and rolls back
  visibly on failure.
- Keep interaction feedback cheap: hot-path state stays local or narrowly
  derived, not wired into heavy trees; pointer work coalesces per frame.
- One drop region has one visual owner, and drop targets speak one affordance
  language across files, sessions, tabs, and panes. Overlapping targets resolve
  to the active one instead of stacking overlays.
- Forgiving geometry beats pixel-perfect triggers; edge actions live near their
  edge, not clustered in the center.
- Expensive stateful surfaces stay mounted when hidden. Visibility is not
  lifecycle.

Prove speed with realistic content. A fast empty-state demo says nothing about a
long transcript or a busy terminal.

## Keyboard & cancellation

- Keyboard ownership follows focus. The focused surface wins its keys; shell
  shortcuts must not steal a terminal's or editor's bindings.
- Focusing the Sessions sidebar preserves the last active chat's visual emphasis.
  Dimming still distinguishes session panes; sidebar navigation must not desaturate
  the chat or transfer its active highlight to a hidden primary tab.
- Focused and hovered chat panes both retain full color and opacity. Only panes
  that are neither focused nor hovered recede, with 20% desaturation.
- Register global shortcuts through the shared layer, not ad-hoc listeners.
- One cancel gesture does one thing: cancel the active interaction, or close the
  topmost dismissable surface — never both, never the control underneath.
- Cancellation is synchronous in the UI even if cleanup is async: overlays,
  cursors, and pending gesture state clear at once.
- Flows that deliberately cannot be dismissed (install/onboarding, destructive
  confirmation) must make that explicit.

## i18n

- Every user-facing string goes through `useI18n()` (`src/i18n/context.tsx`).
  No literals in JSX.
- **Update all locales together** — `en`, `ja`, `zh`, `zh-hant`. A string change
  in `en.ts` that skips the others is a regression (drifted punctuation,
  stale labels). Keep trailing-punctuation and tone consistent across all four.

## State (TypeScript)

The detailed state contract lives in the scoped
[`AGENTS.md`](./AGENTS.md). Visual code follows these essentials:

- Shared/cross-component state → small **nanostores**, not prop-drilling.
  Each feature owns its atoms; shared atoms live in `src/store`.
- Rendering components subscribe with `useStore`; non-render actions read with
  `$atom.get()`.
- Subscribe to derived coarse facts instead of high-frequency source atoms when
  the component does not render the full value.
- Colocated action modules over god hooks. A hook owns one narrow job.
- Keep persistence beside the atom that owns it. Route roots stay thin.
- Prefer `interface` for public props; extend React primitives
  (`React.ComponentProps<'button'>`, `Omit<…>`).

## Affordances

- `cursor-pointer` at the primitive level (Button, dropdown/select) — don't
  hardcode it per call site.
- Quiet pointer focus; keyboard-focused controls retain the shared visible
  focus outline. Titlebar actions have no active-background state, except an
  open `titlebar-popover` trigger, which identifies its floating or docked card.
- `Esc` closes every dismissable overlay/dialog (install/onboarding excluded);
  close is an x-icon, not the word "Close".

## Before you add something — checklist

- [ ] Reuse a primitive (`Button`, `SearchField`, `SegmentedControl`,
      `ListRow`, `Loader`, `ErrorState`, `LogView`, `ConfirmDialog`) instead of
      forking one?
- [ ] Tokens (`--ui-*`, `shadow-nous`, `--stroke-nous`) — zero raw colors /
      one-off shadows?
- [ ] No `className` overriding a primitive's padding / size / radius / chrome?
- [ ] Tips only where hover teaches something new (no kebab / menu-trigger
      tips; unlabeled chrome that needs discovery gets `<Tip>` + `aria-label`)?
- [ ] No native `title=` on buttons?
- [ ] Keybind hints on tipped buttons use `useKeybindHint` / `TipKeybindLabel`?
- [ ] Overlay uses `shadow-nous` + `border-(--stroke-nous)`, no hard border?
- [ ] Flat — no card-in-card, no gratuitous row dividers?
- [ ] No automatic navigation, focus steal, or pane opening from background
      events?
- [ ] Direct manipulation paints immediately and rolls back cleanly on failure?
- [ ] Hot interactions avoid broad subscriptions, layout thrash, and
      `transition-all`?
- [ ] Keyboard ownership and single-action `Esc` behavior are correct?
- [ ] All four locales updated for any new/changed string?
- [ ] `cursor-pointer`, focus ring, and `Esc`-to-close behave?
- [ ] Touched a primitive, token, or variant? Its named-contract entry in this
      file is updated in the same change.
