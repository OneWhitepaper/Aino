---
name: Aino Desktop
description: Approved neutral desktop presentation, aligned to the 2026-11-09 interactive design.
colors:
  primary: "#353a49"
  canvas: "#fcfcfd"
  navigation: "#f6f7f9"
  surface: "#ffffff"
  soft: "#f0f1f4"
  line: "#e4e6eb"
  ink: "#252831"
  secondary-ink: "#555d6b"
  supporting-ink: "#677080"
  warning: "#966419"
  danger: "#b33e3e"
  success: "#287054"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  dialog-title:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control: "6px"
  card: "14px"
  menu: "12px"
  panel: "16px"
  composer: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "32px"
  notification-summary:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
    width: "380px"
---

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

## Approved desktop alignment (2026-11-10)

The user approved the notification prototype and then explicitly requested its
visual language across **all app-owned desktop pages and components**. The visual
authority is `aino-notifications-v2/style.css` and the supplied screenshot dated
2026-11-09. Its neutral palette and component hierarchy replace the earlier
lavender primary and independent compact page scales; existing operation and
identity contracts below remain in force.

ThemeProvider owns the default light/dark palette and remembered font choice.
Body and navigation are 14px; actions/labels 13px; supporting text 12px; section
headings 16px; modal headings 18px. Do not redefine the global ladder inside a
settings page. Semantic syntax, diff, chart and status colors keep their roles.
General-purpose icons use official Codicon geometry through the existing
SVG/ref-compatible adapters. Eight compatibility symbols retain their original
sources where Codicons has no equivalent; brand portraits, provider logos, file
types and specialized geometry keep their identity.

The notification summary is a 380px right-aligned card with its own footprint
below the page header, 14px corners, restrained shadow and text actions. It never
covers a transcript or composer. The primary workspace owns the visible frame;
a shell fallback keeps notices reachable when that workspace is hidden or
Settings is active. Hidden frames keep their children mounted and release timer
readers. There is one existing notification queue and no duplicated action owner.
While a shared dialog is open, CSS hides the summary and disables its pointer
events while retaining its footprint; closing the dialog restores the summary.

## Approved Aino interface direction (2026-10-28)

Aino adopts the reviewed AionUi-inspired presentation across every app-owned
surface. The reference was reviewed at AionUi commit `11cd2a9a20d1e033157636efc570b41384c66d85`;
it is visual grounding, not a dependency or a source of application state.
Existing Aino/Hermes components, routes, feature ownership and capabilities remain
canonical. Do not replace them with prototype handlers or remove capabilities
that the mockup does not show.

- The default primary rail is 260px, resizable and persisted through the existing
  layout store. Pale neutral navigation, soft selected rows, white reading and
  management surfaces, hairline seams and restrained shadows form one hierarchy.
- Use the existing system sans stack and remembered font preference. Reading
  and navigation roles are 14px, controls and labels 13px,
  supporting copy 12px, section titles 16px and page titles 22–24px. Conversation
  scale is still applied exactly once. Code,
  terminal content, and embedded user documents retain their own typography.
- Controls and rows use 6px corners, cards 14px, menus 12px, floating panels 16px,
  and the composer 20px. Native circles (avatars, radio controls, send) remain circles.
- `styles/aino-theme.css` owns shared surface/type roles; `aino-chat.css` owns
  home/transcript geometry; `aino-workbench.css` owns file/preview chrome.
  Extend existing primitives before styling a caller. Menus, tooltips, dialogs,
  alerts, empty/error/loading states, account/onboarding and auxiliary windows
  inherit the same contract, including dark mode and native translucency.
- Preserve every operation, scroll region, keyboard/focus owner, portal layer,
  route, saved layout and profile/connection boundary. File tabs, source/preview,
  edits, save, split, review, terminals and external open keep existing handlers.
  Workspace selection still previews; only the explicit switch action activates it.
- Native OS file pickers and third-party embedded documents keep their native
  presentation. Only app-owned surrounding chrome is themed.
- The default Sessions/Agent Hub rail uses a shared 56px brand row below the
  native window controls. Its current title (Aino or the contributed pane name)
  opens the existing dropdown menu, with descriptions and a checked current item.
  This two-option menu uses a compact 240px width capped by the viewport,
  56px minimum rows, 14px names and 12px descriptions, with shared menu/control
  corners. Long localized descriptions wrap rather than widening the menu.
  A lone pane has a static brand without a chevron. The host owns presentation;
  existing pane activation still owns chat and routines. Unknown guests, layout
  editing, detached panes and minimized zones retain the ordinary pane strip.
- Approval menus share one presentation in the composer and status bar: a
  320px surface (clamped to the viewport), 16px icons, 13px option names and
  12px supporting text. Plain-language choices explain the existing profile
  approval policy; the off option and its trigger use the warning color. This
  setting does not grant filesystem/network access or bypass system permissions
  and safety rules. Keep the existing gateway configuration and approval flow.

## Group conversations

Group conversations are a named-member desktop chat surface, scoped to the
contracts in [the group design system](../../docs-local/group-human-redesign/DESIGN.md).
Robot messages stay on the left and human messages on the right, using existing
32px avatars, 14px body text, 12px metadata and a 66ch maximum message measure.
Historical human labels are preserved unless the current user's identity is
known. Messages and composer share a centered 1120px maximum column with 40px
horizontal gutters; actual chat containers at least 1400px use 48px, at most
960px use 24px, and at most 480px use 16px. Container width owns these rules,
including when files or group information reduce the available reading area.

A main group has one shell-owned title. Its content begins with a compact
54px-minimum participant toolbar: existing portraits, readable names and state,
search and group information. Standalone and older in-rail fallback surfaces
retain their own title and Back; loading and failure gates follow the same
main-versus-fallback rule. The information panel is 320px wide beside workspaces
at least 1100px wide and uses the existing accessible Dialog below that width.
Members, Files and Manage are separate tabs of the same panel. Member actions
focus the composer; narrow-dialog mentions close the dialog first. IDs remain
available in ownership details without leading ordinary member actions.

The mention picker leads with a portrait and readable name, provides one
All members choice, searches names and handles, and reuses the portal Popover.
Displayed names are projections of exact frozen addresses, never routing keys.
Drafts and outbound requests keep their original canonical handles; edits,
renames and same-name members cannot silently select a different recipient.
Copy/cut exports readable plain text and private recipient metadata scoped to
the exact source and room. Only validated same-scope metadata restores bindings;
foreign or invalid metadata neutralizes ASCII @ and prompts reselection.
Unbound recipient-looking text blocks a fresh send rather than becoming an
accidental broadcast. Recipient summaries follow the runtime's actual raw-text
parser, including its existing code/email rules; duplicate display names retain
an explicit count instead of being deduplicated. Historical display and search
may show names, but copying history and exact retries preserve original bytes.

Agent Hub keeps its monitor and shared search above one scrolling Groups/Bots
region. Existing remembered width, custom sections, hidden bots, filters, drag
operations, context menus, notifications and host-owned account controls retain
their owners. Group rows without real message previews show member information,
never invented activity. Conversation navigation presents one current title
with a compact switcher; ordinary, bot and group chats never form a horizontal
list across the normal main surface. Each mode and exact workspace owner
restores its own conversation and draft. Visibility, focus, menus and keyboard
actions use the same eligible conversations; explicit splits retain independent
current titles. Files, browser, review and terminal keep their tool tabs.
Contributed group panes use captured room authority and workspaceScope metadata;
renaming never changes identity or close/disband lifecycle callbacks.

The reply strip above the composer shows the current member's real 24px avatar,
name and response/approval/stopping state. Queued counts come from actual member
activity. Completed replies require a committed member message and matching
settlement for the same room, discussion and thread; cumulative task counts,
missing activity and unscheduled members are not substitutes. Ambiguous
concurrent discussions omit the count. Stop this round appears only for genuine
working/queued activity and disables repeat stop while stopping. Errors are
compact expandable events; they do not claim a successful reply. Canonical and
legacy rooms retain original send journals, thread ownership, attachments,
approvals, discard confirmations and exact retry behavior. Message following
uses use-stick-to-bottom and yields when the reader scrolls away. Group styling
stays in canonical-group.css with shared theme and control primitives; no UI
animation invents streamed reply text or rewrites historical facts.

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
- **Workspace selection previews before switching.** A compact, searchable left
  list sits beside the selected workspace's wider detail area. Selecting an item
  only changes the inspected profile; the explicit footer switch action alone
  reuses the existing profile activation flow. Selected and current are separate
  states. Closing the inspector does not switch profiles or reopen it on a roster
  refresh. The heading owns New workspace; the detail header reuses the existing
  rename dialog and menus. Model settings, capabilities, SOUL.md editing and
  storage retain their routes, persistence and profile scope. Narrow containers
  stack list and detail; the overview may use compact cards when no detail is
  inspected. The default workspace uses the Aino mark, while named workspaces
  retain ProfileGlyph and their configured identity colors.
- **Pages are durable destinations.** Chat, Settings, Skills, Messaging, and
  Artifacts remain in shell chrome. Durable management pages temporarily occupy
  the full work area while navigation remains available; saved pane layout and
  ordinary file-editor drafts survive the presentation change. Hiding a pane is
  not permission to unmount it or recreate its state. Do not hide a distinct
  product noun inside an unrelated page.
- **Capabilities is a directory, not a billboard.** Keep the four existing
  Skills, Plugins, Connectors and Tools destinations. The page identity and
  configuration target sit above their tabs; the configuration target never
  switches the active workspace. Skills and Plugins reuse the existing
  installed facet for Discover / Installed, with the existing search, view
  preference, category/source facets and advanced tag/sort controls. Categories
  and sources remain in the existing filter popover rather than a permanent
  side rail. Discover / Installed occupies its own row above search, filters and
  view controls. Compact recommendations precede uniform neutral cards, and
  details reuse the accessible dialog as a right-side drawer.
  Original names, authors, installation identifiers, editor/archive actions and
  profile/connection routing stay authoritative. Connectors and toolsets keep
  their existing management flows and shared presentation primitives.
- **Workspace settings keep the existing configuration owner.** Three horizontal
  categories — Projects and discovery, Terminal environment, Files and execution —
  reuse the existing configuration draft, scoped autosave, schema and project
  refresh. Full-width directory inputs and line-separated list editors serialize
  the same string arrays; hidden categories keep their drafts mounted. Discovery
  off preserves the configured roots and exclusions, and search reveals its target
  without enabling scanning. Project/Strict are directory and Python choices, not
  permission controls. Unknown configuration rows retain the generic editor.
  Shared input, switch, tabs, settings groups and theme tokens own the controls;
  prototype reset/save chrome does not become a new persistence mechanism.
- **Conversation, Safety, Browser, Memory, Voice and Advanced share one form rhythm.**
  Their horizontal categories arrange existing schema rows and feature slots;
  scoped configuration drafts, autosave, device preferences, credentials, Vault,
  memory authorization and voice providers keep their existing owners. Hidden
  categories stay mounted so switching tabs preserves drafts. Field, device and
  credential deep links select their category before consuming focus parameters;
  legacy Tools and Terminal links resolve to Advanced's Runtime category.
  Mode cards write the original enum values, percentage controls save fractional
  values without rounding, and multiline editors save the existing string arrays.
  Unknown schema values retain the generic editor. Tool and credential disclosures
  start closed; config load failures retain independent device controls and retry.
  Shared primitives and theme tokens own typography, borders and responsive rows;
  prototype-only demo actions do not create a second settings mechanism.
- **Model defaults have one owner and one Apply.** The model page uses five
  horizontal categories and one current-default summary. Reopening paints the
  existing connection/profile catalog cache while refreshing
  in the background. Same-account built-in refreshes retain the known model label;
  applying waits for fresh authorization. Late reads cannot restore an older default.
  Aino built-in, official third-party services and custom API models are mutually exclusive drafts in the same main-model
  form; switching sources or confirming the existing catalog dialog stages a
  choice. The page Apply reuses existing configuration writes and scoped Aino
  preferences. Activating Aino clears only the higher-priority main route,
  retains provider credentials/endpoints and preserves live conversations.
  Summary and runtime share the available preferred/default selection rule.
  Composer model and reasoning edits belong to the current conversation only.
  New Chat and `/new` resolve Settings defaults, including when the draft has
  not sent its first message. Per-model conversation options share that scope
  and never become persisted defaults for another conversation.
  Auxiliary task tables and MoA sections retain dynamic tasks, all routing,
  reasoning and existing autosave; schema-backed fallback/delegation controls
  keep their original owners. Hidden sources retain their local drafts.
- **Route overlays are short tasks.** Command Center, Cron, Agents,
  and Starmap render as `OverlayView` cards and return to the previous route on
  close. Settings is a full-page workspace with its own navigation and return
  affordance. Model/session pickers and dialogs layer above the current
  surface; they are not navigation stacks.
- **Panes are working context.** Preview, files, review, and terminal remain
  attached to the current task. Their state survives temporary hiding and chat
  switches where the underlying tool is meant to persist.
  Files, Summary and newly created terminals follow the last interacted chat
  tab, including split chats. Clicking a tool does not silently switch back to
  the main chat. Existing shells keep their processes and directories; moving
  their tab into the shared tool host never recreates or retargets the shell.
  Unscoped Review follows the same
  chat, while an explicitly opened repository stays pinned until another explicit
  review action. Source/profile ownership gates filesystem actions; delayed reads
  cannot paint or open files from a previous project or machine.
- **Summary output clicks preserve open work.** Different output URLs open
  separate browser tabs; clicking the same output focuses its existing tab.
  File identity and existing source/preview behavior stay authoritative.
- **Connection and pause states explain the next step.** Cold startup uses the
  Aino mark, localized phase and real progress. Reconnecting does not cover an
  already usable shell. A stopped response keeps its announcement accessible
  without a visual banner. The empty composer replaces its primary action with a circular Continue button;
  new text or attachments retain the normal Send path. Stop settlement and a
  pending continuation disable the control until the existing protocol allows it.
- **Provider setup lives in Settings.** Missing credentials do not summon the
  startup provider picker over the workspace. A request-time notice opens the
  existing Model settings for its owner; explicit service authorization retains
  the existing OAuth/API key flow. Account sign-in remains separate.
- **Summary is a persistent workspace card.** Its list icon precedes Terminal
  and the right-sidebar toggle. The titlebar button alone opens and closes it;
  outside clicks, Escape, conversation switches and opening other panes leave
  the choice intact. The card belongs to the last interacted visible chat,
  inside its pane, before sibling file, preview, review or terminal panes.
  File and preview focus never moves the card out of that conversation.
  It reserves a right-hand column, recentering the transcript and composer
  together within that chat. It sits in a 320px rail with 12px outer gutters.
  The rail shares the active chat
  canvas instead of painting a separate full-height sidebar; its compact paper
  card uses 14px corners, quiet elevation, 12px section labels and 13px regular
  resource rows. Outputs and Sources keep their add actions in the section
  header. Empty Outputs retains that action without a large placeholder row.
  The card scrolls independently and never mutates the user's saved tiling tree
  or remounts chat/terminal surfaces. When its owning chat has less than 960px
  available, it floats at that chat's top-right, within the same pane. It never
  stacks beneath the composer or enters the file/tool panel. The compact card
  keeps the same 320px width capped by its chat, scrolls independently, and uses
  a scoped CSS anchor to stop above the existing composer dock. It does not
  reduce the chat's height. Opening uses a 200ms slide/resize transition, disabled
  under reduced motion. Closing and transferring ownership hide the old card immediately.
  Its contents follow the selected
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
  empty result. System resource meters have no standalone Settings page and
  are not displayed or polled by this card. Hardware detection remains available
  to local model setup.
  Context usage lives beside the model in the composer: a neutral progress
  ring reveals usage on hover and the existing breakdown on click. It reads
  that composer's session and owner-routed `session.context_breakdown` request,
  refreshes when idle, and reflects the existing compaction state. Summary
  no longer fetches or duplicates those details.
  Known occupancy appears immediately, independently of category details.
  Cold sessions restore only history-validated provider usage, without starting
  an agent. Unknown occupancy stays unknown; lifetime throughput is never its
  substitute. Shared reads reuse one calculation per session; a five-second
  detail deadline leaves a quiet explanation and an explicit Retry action.
  Category details for a cold session update after its next conversation turn.
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

Appearance uses five page-local categories: Theme & text, Window & layout, Chat
display, Habits & guidance, and Desktop pets. Brightness preview cards select only
Light/Dark/System; they do not restore the retired palette marketplace. Shared
Select, Switch, Tabs and settings rows own controls; lower-frequency terminal,
window, transparency, tool-result and interaction options live in disclosures.
Search opens the owning category and disclosure before focusing its existing
setting ID. Tabs retain mounted editors and pet state, with standard keyboard
navigation. Presentation previews read the existing preference stores and cached
configuration, use sample content, and never create agent work or duplicate saves.
The pets page retains real artwork, catalog installation, generated-pet editing,
export, removal confirmation, size and roaming. Native tray and transparency
availability continue to follow the existing platform capabilities.

The approved reply style is also the system type and density ladder: 14px
body copy at 1.6 line height, 14px navigation,
13px controls, activity and group labels, 12px supporting metadata, and 16px
section headings and 18px dialog headings. Conversation size aliases resolve
from these existing Aino roles. Conversation text defaults to 100% (14px),
with a 1.6 reading line height, 18px/16px first/second-level reply headings,
and 13px code and reasoning text. These sizes scale together with the reader's
saved chat preference; metadata and surrounding navigation remain independent.
Settings inherits the same 14px reading/navigation role, 13px form labels,
12px supporting labels, 16px sections and 22px page titles; body portals inherit
the same shared base roles. Named Tailwind utilities (`text-xs`, `text-sm`, `text-base`,
`text-lg`) resolve to the same caption/UI/body/title roles. Project names,
recent-session titles use the 14px body role; model and reasoning selectors use the 13px UI role;
timestamps and other secondary metadata use the 12px caption role. Do not
shrink primary actionable labels to caption size or introduce 9–11px microcopy.
Compact navigation and dense data can retain their explicit UI
or caption role. The existing bubble and shared table-header fills use neutral soft surfaces; status, syntax and diff colors keep their meaning.
User bubbles still consume `--dt-user-bubble` and the existing
`--user-bubble-keep` preference. At full transparency the fill disappears and
the outline remains; changing the visual palette must not bypass that setting.

App-owned artifact, billing and Markdown-preview tables opt into the same
`aino-data-table` presentation marker without a replacement table component.
Headers share a light fill and fine row separators; column definitions, sorting,
filters, pagination, copying, selection and horizontal scrolling stay with
their existing owners. Guest HTML, embedded catalog pages, diagrams
and terminal output retain their own content styling.

Shared `DialogContent` owns its 24px body padding and 16px gap. The outer
shell stays unclipped because nested select/popover portals live there; only
the existing inner body scrolls. Reply billing follows this same contract,
without a caller-specific scroll container.

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
form rows: a single neutral one-pixel outline, 12px corners, no shadow, and
18px horizontal insets. Keep section titles outside the outline. `ListRow`
owns `data-settings-row`; custom row wrappers use the same marker when they
include an inline editor. Only sibling rows inside a group receive dividers,
so descriptions, status messages and expanded controls stay with their row.
Do not add another group around already framed tools or lists. Grouped rows
use a 36rem content-width breakpoint for the label/control split, accounting
for the added insets; narrower groups stack. Use shared stroke tokens in
both brightness modes, without flattening native Glass surfaces.

My account uses one profile card, a wallet/subscription overview and a ledger
section, followed by a collapsed device-authorisation section. Its direct-child
cloud-sync card has a 24px top margin and 16px vertical / 18px horizontal padding,
scoped to the account page. Profile editing
uses the existing dialog; sign-out reuses the shared confirmation and pending
state. Wallet display may round its decimal string to two places, with the full
authoritative amount available in the adjacent disclosure. Account changes
retire local editors and existing billing scope boundaries remain authoritative.
Initial account restoration is distinct from signed-out login. A newly created
window keeps its workspace geometry and shared PageLoader until native identity
is known; only confirmed sign-out or authentication recovery enters compact
login mode. Restoring a known account does not wait for public login options to
finish their network request. The workspace becomes visible after native bounds
settle, including when its account action owner changes. Later sign-in loading
keeps the existing form and second-factor input mounted.
The ledger opens on orders; usage filters can be hidden without discarding
their draft or applied query. Narrow containers stack the overview and turn
ledger rows into readable records, retaining timestamps, currencies and actions.
Recharge automatically previews server-calculated payment, fee and credit amounts
after a brief input debounce. Inputs remain editable while previewing; editing or
closing invalidates late results. Only an explicit payment action creates an
order with that preview, retaining final-price confirmation, payment recovery,
cancellation and balance refresh.

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

The reference light palette is a `#fcfcfd` page canvas, `#f6f7f9` navigation,
`#ffffff` content and `#e4e6eb` seams. Primary, secondary and supporting ink are
`#252831`, `#555d6b` and `#677080`; primary actions use `#353a49`.
These seeds, including their explicit dark counterparts, belong to ThemeProvider's
fixed Aino palette (`monoTheme`); `aino-theme.css` aliases existing `--theme-*`
and `--dt-*` values into shared `--ui-*` roles. Do not maintain a second raw
light/dark palette in route CSS. Primary actions use the contrast-adjusted neutral
roles; semantic error/success/warning, syntax and diff colors retain their meaning.
Landing, sidebar, body portals and native Glass resolve through those same roles.
Use the normal UI font for labels; reserve monospace for code, commands, paths
and numeric data.

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

Menus and selects use the shared 12px menu radius; dialogs, sheets and ordinary
popovers use the 16px panel radius (sheets round their exposed edge). All share
the same `shadow-nous` + `--stroke-nous` treatment.
Every floating list —
`DropdownMenu`, `Select`, and Popover + cmdk pickers
(`<PopoverContent variant="menu">` + `<Command variant="menu">`) — paints
through `src/components/ui/menu.ts`, so a list reads the same wherever it
opens. Typed fields with suggestions use `ComboboxInput`, never
`<input list>` + `<datalist>` (Chromium paints that as its own OS popup).
Shared menu and popover surfaces cap their width to the viewport with 8px side
gutters; long menu labels wrap instead of pushing actions outside the window.

Drag affordances may use tokenized
dashed targets and local blur. These are semantic surface classes, not licenses
for call-site shadow or border inventions.

`PopoverContent variant="card"` provides a 320px floating card with 14px corners,
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

## Window background behavior

Settings → Appearance → Window layout offers **Minimize to tray**, off by default and
local to this desktop installation. When enabled, minimizing ordinary windows
hides them without stopping their work. Close, Alt+F4, and Cmd+Q keep their
normal behavior. The tray's **Show Hermes** restores hidden windows;
**Quit Hermes** keeps the ordinary active-work confirmation and teardown.
On macOS the tray lives in the menu bar; the Dock icon hides only when no normal
window remains visible and returns on restore. If the tray is unavailable,
ordinary minimize/close behavior is retained rather than hiding an unreachable app.

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
| `--aino-action-bg / -fg / -hover` | muted brand primary action and contrast-safe inverse; shared by button, switch and checkbox |
| `--aino-radius-control / -row / -panel` | 6px controls and selected rows, 16px floating panels |
| `--aino-text-caption / -label / -ui / -body / -title / -page-title` | 12 / 13 / 13 / 14 / 16 / 24px base roles; settings shares these roles and uses a 22px page title |
| `--aino-surface-*`, `--aino-scrim`, `--aino-focus-ring` | shared paper, rail, strokes, state fills, backdrop and input focus |
| `--aino-landing-*`, `--shadow-aino-landing-composer` | home/sidebar aliases of the shared semantic roles and `shadow-nous`; no independent light or dark palette |

Never hardcode `border-gray-*`, `bg-white`, `text-black`, etc. The two tiles in
`BrandMark` (white in light mode, `#0d1117` in dark) are the sanctioned literals
(the mark needs a fixed backdrop).

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
`icon-sm` / `icon-lg` / `icon-titlebar`. `icon-send` is the 32px circular send
control; its chrome belongs to Button rather than a consumer override.
`touch` provides a 44px minimum target for compact mobile navigation.

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
(list titles must not trail while scanning). Tooltips use the shared 6px control radius.

**Tooltip placement.** Choose intent through `placement`: `control` above (default), `toolbar` below, `row` to the right, and `left-rail` / `right-rail` inward. Explicit `side` and `align` override the preference. Radix flips and shifts for collisions, keeps the arrow attached, and hides detached triggers. Controls and toolbars use their owning pane as a boundary; row descriptions and rails may extend into the window. Use `boundary="viewport"` for an intentional escape. Short labels size to content; descriptions wrap within 24rem and the available space, in one rounded bubble.

**Slash descriptions.** Keep autocomplete rows single-line and ellipsized, but reveal the complete catalog description to the right of the hovered row. Use the shared bounded tooltip, collision padding, and word wrapping; it must not intercept row selection. Catalog and completion producers preserve the full author-supplied description.

**Model search.** Model filters and their highlighted labels treat hyphens, dots, underscores and spaces equivalently. Preserve original label spelling inside marks. The shared highlighter remains literal for other surfaces such as the command palette; model callers explicitly opt in. Model identifier search does not use dictionary spellcheck.

**Composer model picker.** One search covers Aino models, favorites and configured providers.
Unconfigured provider catalogs and remembered custom models without their configured provider
stay out of the list and search. Inherited shell credentials alone do not configure a provider.
Keep the current saved provider's recovery row when its credential is unavailable. Managed
Aino models appear once in their built-in section.
Configured external models appear directly under their Third-party services or Custom models source heading; a saved
provider-collapse preference must not hide their rows in the composer. Other model
pickers retain their provider grouping and collapse controls.
The list and adjacent detail card use existing menu primitives and theme tokens. Hover, focus
and the detail arrow preview a model; only selecting its list row applies it through the
existing session controller. Details show available catalog facts, never invented prices or
capabilities. Active Aino parameter edits retain account and platform-owner verification.
Keep the two-card picker compact: a 480px maximum width, 30px model rows and a 216px
scrolling list. Tighten card padding and control heights while preserving readable type.
Detail values align to the right; the submenu chevron must not take a second automatic margin.
Anchor the list's right edge above the model trigger, with details extending to its right.
Measure stable layout widths for the alignment offset; keep both cards inside the positioning
engine's collision box so the complete menu shifts safely away from window edges.
At narrow widths, details replace the list; Back or Escape returns to search. Escape inside
an options submenu closes that submenu first. Refresh, favorites, custom model management
and selection failure recovery retain their existing behavior.
Configure custom models opens the shared endpoint editor in a compact, 540px dialog
owned by the requesting connection and profile. Its primary flow is a name and API URL,
API key with a connection test, then an editable model selector. Custom configuration
has no provider selector; saved connections appear in a separate, initially collapsed
Saved configurations section for editing. Name and URL remain visible while editing;
each saved connection has a separate delete action using the shared confirmation,
with all mutations disabled until deletion finishes. Deleting the selected connection
clears its draft and refreshes the catalog; cancellation or failure retains it.
protocol, discovery and context options stay in the collapsed advanced section. Saving adds the configuration
without switching the current or default model. Settings reuses the same editor and
retains its explicit activation, deletion and default-model actions.
Official third-party setup is separate: choose a provider and enter its API key to
fetch models through the existing provider APIs. Provider presets and credential
identities come from backend metadata, never a second frontend registry. Proxy and
private endpoints belong to Custom API models with editable URL, key and model.
Model services settings exposes both flows on the existing page. Saving a key or
endpoint refreshes available models without applying a default or changing a live
conversation. Source switching retains independent provider/model drafts and clears
unsaved credentials. Official providers and same-named user endpoints remain distinct:
the official API uses its canonical credential, while the custom connection retains
its explicitly namespaced route and credential. Never hide the official setup entry
or borrow a custom connection's models because their display names match.

**Keybind hints in tooltips.** On a tipped button bound to a rebindable hotkey,
use `<TipKeybindLabel actionId="..." />` — it reads the i18n label and the
current combo from `$bindings`. Pass `text={...}` only when the label is
context-dependent (e.g. "Show" / "Hide"). Never hardcode combos; always use
`useKeybindHint` or `TipKeybindLabel`.

Notes:
- Text and icon buttons use the shared 6px control radius; text sizes use padding
  + line-height with a 32px default / 28px small minimum, allowing wrapped or
  scaled content to grow. Boxless text/link actions have no radius.
  Primary actions use `--aino-action-*`, not the link accent.
- SVGs inherit `size-3.5` (`size-3` at `xs`). Don't re-set icon size.
- Polymorph with `asChild` when the button must render as a link/Slot.

## Badges — one component

`src/components/ui/badge.tsx`. Variants: `default` (neutral soft fill), `muted`,
`warn`, `destructive`, `outline`, `solid` (primary fill — icon-corner counts).
Sizes: `default`, `xs`, `overlay` (titlebar glyph counts).

## Profile rail

The profile rail keeps its create/import actions outside the scrolling squares.
Clipped horizontal edges reuse `edgeMask(edges, 'x')` from `fade-scroll.tsx`;
the default axis remains vertical for `FadeScroll`. Fitting content is unmasked,
and profile drag gestures temporarily remove the mask so the dragged square stays legible.

## Context-sensitive dialogs

Sudo password dialogs keep the backdrop unblurred (`DialogContent`'s
`blurBackdrop={false}`) and show the complete, selectable command before the
password field. Long commands wrap and scroll; missing backend context is
explicit, never inferred from another tool row. Other dialogs retain the shared
blurred backdrop.

## Form controls

- **`controlVariants`** (`src/components/ui/control.ts`) is the shared shape for
  `Input` / `Textarea` / `SelectTrigger`: 6px corners, 13px normal UI text and
  padding-driven size with a 32px normal / 28px extra-small minimum. New
  text-entry controls compose it. Fields have neutral
  fill/hairlines, accent-only focus and a semantic invalid state; grouped fields
  inherit the same font size as bare controls. No page-specific control overrides.
- **`Textarea appearance="composer"`** is a plain, 14px multiline editor when
  the surrounding composer owns the fill, border and focus indication. It keeps
  native editing, disabled and placeholder semantics; the default `field`
  appearance and shared form-control sizing remain unchanged.
- **`SearchField`** — borderless, underline-on-focus, auto-width. The only
  search input. Don't build boxed search bars; don't wrap it in a bordered tile.
  Empty lists hide their search field.
- **`SegmentedControl`** — the choice control for small mutually-exclusive sets
  (color mode, tool-call display, usage period). Replaces radio piles and
  pill rows. The neutral track and active paper option share the control radius,
  with the same keyboard focus outline as buttons. Menu selection rows use the
  6px row radius; normal route tabs use a soft neutral selection fill.
- **`Switch`** (`size="xs"`) — bare, with `aria-label`. No bordered text wrapper.
- **`FanMenu`** (`src/components/ui/fan-menu.tsx`) — one hub control that
  fans sibling toggles out on hover: `direction` `vertical` | `horizontal`
  (split around the hub) | `arc`. Discs are `Button` `floating` off /
  `default` on; tips face outside the fan according to its geometry. Use it where a row of rarely
  touched toggles is costing input width (the composer's voice controls).

## Layout

In the browser-hosted Desktop, composer controls retain 44px targets on
coarse-pointer surfaces. Its collapse stages budget the actual control-size
token; below the two-target width budget, the context menu and Send occupy
separate rows rather than clipping or shrinking. Native Desktop keeps the
compact stages sized for 24px controls.
The voice engine split-button uses `--composer-voice-menu-size`: compact on
desktop, matching `--composer-control-size` on touch surfaces.
Narrow browser touch layouts show the current session tab with an open-tab
count. Its menu exposes every tab, while the new-tab action remains beside it.
In the browser-hosted Desktop, outside taps dismiss narrow sidebar overlays;
cancelled or scrolling gestures do not. Native Desktop keeps its overlay until
Escape, the toggle or hover-out. Touch transcript gestures select a pane without
focusing its composer.

- **Navigation rail:** new layouts open at 260px. Existing saved widths remain
  authoritative, and the supported 245px minimum is unchanged. A quiet gray rail
  continues into its portion of the native titlebar, with one continuous hairline at the content boundary.
  The tree sash owns the divider and its resize target; panes do not add
  edge borders or shadows. Titlebar-local geometry follows resizing, hiding
  and side swaps without per-frame root style invalidation. Glass retains
  the body field painter plus one subtle rail-tone layer, not stacked fills.
  Glass sidebar scope follows the foreground rail: Settings owns its boundary
  while open, and its narrow dropdown leaves no vertical glass strip.
  Sidebar Glass follows the rail's physical left and right bounds, including
  after side swaps. Chat and its Summary retain their shared opaque field;
  moving a navigation rail never leaves its old tint behind.
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
- **Gutters:** generic overlays reuse `PAGE_INSET_X` / `PAGE_INSET_NEG_X`
  (`src/app/layout-constants.ts`). Management page owners align heading, tabs,
  search and results on one 1088px outer column with 32px side gutters, reducing
  to their compact gutters on narrow containers. Settings owns its separate
  reading column. Do not add a theme-wide route selector to correct a page's
  internal geometry.
- **Master/detail overlays:** `OverlaySplitLayout` + `OverlaySidebar` /
  `OverlayMain`. Cron, profiles, etc. ride this — don't rebuild a titlebar
  shell.
- **Settings shell:** `SettingsShell` reuses `OverlaySplitLayout` and `OverlayNav`
  for the 236px navigation column (220px at the compact desktop breakpoint),
  back/search controls and active-route title. Four open, non-interactive
  section labels organize every destination: personal/appearance, conversation/
  intelligence, work/connections and security/system. Settings navigation never
  collapses these collections. Its local search filters destinations without
  changing the active route; Enter and the shortcut keep the complete existing
  settings palette available. Matching plugin descendants reveal their original
  route handlers. System controls sit inline at
  the heading's trailing edge: runtime status, command center and More. The
  navigation has no system footer. More retains configuration import/export,
  confirmed reset and About with live version/update state. Runtime popovers
  open below the header; their existing profile and connection scope remains.
  Main content uses a white reading surface with a bounded 56rem body, 44px
  desktop insets and its own scroll owner. Embedded bare content keeps its
  caller's width instead of importing a 56rem minimum. The complete native
  account subtree — wallet, subscriptions, orders, usage and devices — remains
  behind its existing account and runtime capability gates. Preview fixtures
  must exercise that native account path rather than treating a legacy dev
  identity's missing capabilities as product content removal.
- **About settings:** a compact centered identity, live version, one short update
  status and one neutral primary action. Website and release notes remain small
  text links. Installation details, supported source-channel controls and remote
  runtime updates live in the existing dialog primitives; remote attention keeps
  a visible indicator on that entry. Check errors summarize their actual cause,
  with the full diagnostic text and copy action in a details dialog. Uninstall
  stays behind the existing ownership probe and retains all original confirmation
  and OS-managed removal rules. Updates reuse the canonical stores, progress
  overlay and actions; pending bundle swaps remain visible.
- **Settings subpages:** `OverlayNav` keeps navigation and disclosure separate:
  labels navigate; the shared `DisclosureCaret` button opens a branch without
  changing the page. Active paths reveal automatically, inactive paths stay
  folded unless manually opened. General comes first wherever present; parent
  labels and parent URLs open the first ordered subpage, never an overview or
  the last visited child. Explicit child links retain their destination;
  the shell resolves the current route title and suppresses only an identical
  page-level heading through the existing breadcrumb context. Differently named
  sections, actions and counts remain; embedded callers keep their headings.
  Narrow Settings windows retain the independently scrolling grouped rail
  at 176px; other overlay surfaces keep the shared navigation dropdown.
  Search and saved field links resolve to the owning child before highlighting.
- **Rows:** `ListRow` (settings `primitives.tsx`) for label/description/action
  rows. Flat, flush-left; no per-row indentation that fights flush headers.
- **Messaging:** platform cards open the existing configuration in a shared
  `Dialog`; they do not change the active workspace. Domestic platforms lead,
  runtime/plugin platforms remain discoverable, and gateway health is separate
  from each platform's state. Keep scope selection, connection-state filters,
  advanced fields, pairing approvals and QR setup available. Saving credentials
  and enabling a platform retain their separate backend operations; retain
  restart/hot-serve feedback and guard unsaved credential edits on close.
- **Capabilities:** reuse `CatalogBrowser`, its filter state and capability actions.
  Primary sections use the shared Radix `Tabs` navigation size: line icons,
  14px labels, separate count badges and a fine active underline on an open track.
  The primitive owns the selection appearance; do not layer text underlines or
  the legacy route-tab fill onto it. The existing dropdown handles narrow panes.
  Discover / Installed sits above a separate search/filter/view toolbar. The
  existing filter popover keeps categories, sources, tiers and tags available
  without reserving a permanent side rail; compact cards or flat installed-skill
  rows use the remaining reading width.
  Categories are single-choice navigation: another category replaces the previous
  one, and clicking the current category or All clears it. Sources and tags retain
  their existing multi-select filter behavior.
  Skills, plugins, connectors and toolset search/results share the capability
  page owner's 1088px outer column and 32px gutters, with space above the first
  section. Embedded catalogues respect the owner's supplied width.
  Skill details open in the existing dialog as a right drawer with overview and
  usage tabs; usage retains the full original instructions and existing editing
  actions. Plugin list mode keeps its existing master/detail management panel,
  including configuration, updates, uninstall and Agent/Desktop controls. All
  categories, profile routing, source links and keyboard focus behavior remain
  available. Narrow windows wrap the heading, retain all filters in the popover
  and keep the detail body scrollable; use existing palette, controls and type roles.
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

On macOS, native traffic lights use a 12-point left inset in every titled window.
Keep the renderer's startup fallback insets aligned with that position so the
adjacent toolbar and panel reservations do not jump when native state arrives.
Windows/Linux retain their previous toolbar startup fallback until native state arrives.

The left cluster shows sidebar, settings, layout editor, and HUD controls. Flip
and the right-sidebar toggle sit on the right; haptics remain in settings.
In Simple interface mode only sidebar, settings and the layout editor render,
and the reserved cluster width shrinks with them (`TITLEBAR_FIXED_TOOLS` is the
one table both the buttons and the width reservation read).
Holding Cmd (Ctrl off macOS) reveals small slot numbers over the target strip's
status dots after 400ms, without changing tab widths. Hints follow the same
binding and hovered/focused-zone resolver as the number shortcuts.

Tab close buttons fade the label with a content mask, not a painted gradient.
The tab reads its surface token directly so glass tint is painted only once.
Close glyphs keep a 24px hit area, including session tabs wrapped in context menus.
`PaneTab` owns its `data-slot` marker after forwarded props so composition cannot
disable that width or the label mask.

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
  opens focused on Cancel for destructive actions and Confirm otherwise.
  `Enter` and `Space` follow the focused button; `Esc` cancels. It owns
  the pending → done → close beat and the inline error — a call site passes an
  async `onConfirm` and nothing else. A third way out (e.g. "Remove from
  sidebar" beside "Delete worktree") goes in the one `secondaryAction` slot.
  Never `window.confirm`: it's an unstyled blocking Chromium modal. A handler
  that wants the answer inline instead of a mounted dialog calls `confirm()`
  from `src/store/confirm.ts`, which renders this same primitive through the
  single `ConfirmHost` at the shell — the way `notify()` backs notifications.
- **Notifications:** `NotificationStack` owns a right-aligned summary card below
  the current page header and a dedicated reading panel beside the workspace. Main, HUD and
  popped-out Browser each mount this same frame inside their actual shell;
  there are no competing corner stacks or over-modal toast portals. Only one
  concise summary appears; the notification/status button keeps every pending
  entry reachable. Hiding a summary preserves its recovery entry. Short feedback
  expires after five seconds unless its caller specifies otherwise; pointer,
  keyboard and detail readers independently pause the remaining time. Actions
  await their real callback, stay single-flight across same-ID updates and retain
  failures for retry. Dispatching a restart intent means only that it was started,
  not that the service recovered. Native OS notification chrome remains OS-owned.
  Long details wrap in one panel-body scroll region, with header and actions
  fixed. On narrow windows the panel temporarily owns the workspace area while
  its conversation and draft stay mounted and inert. Account/source resets
  retire callbacks and the reading epoch; an ID reused by another owner cannot
  inherit old details or hidden state. Backend notices are keyed by connection,
  profile and notice code. Maintenance/snooze actions retain their source and
  never operate on a different foreground workspace. Disk suggestions do not
  promise that history cleanup can solve low disk space; raw diagnostics are
  available separately, never truncated or executed by the UI.
- **Inline alerts:** `Alert`/`AlertDescription` use the shared 14px body role,
  neutral readable text, semantic icons and a complete min-width/anywhere-wrap
  chain. A long title is readable; only compact notification summaries clamp,
  with their full content available in the reading panel. Group, account,
  connection, install and model-form errors reuse this presentation without
  changing their data owner or recovery action.
- **Dialog reading and actions:** `DialogContent.header` and `.footer` are optional
  fixed title and action regions outside its sole `dialog-body` scroller. Existing
  form layouts retain their default body when omitted. `dismissDisabled` locks the shared X,
  Escape and outside dismissal; controlled callers still own programmatic close.
  `ConfirmDialog` keeps its title and footer fixed, keeps errors visible in its body and
  synchronously locks double activation before React paints its disabled state.
  Failure keeps the decision open; success closes only after its real operation.
  Upload consent retains its existing choice to close during upload, clearly
  explaining that this does not cancel an already-started transfer. Required
  update/install gates keep their explicit non-dismissable semantics and focus
  ownership. Root-crash recovery mounts the existing diagnostic consent/upload
  host above the crash shell; the action remains usable after the app host unmounts,
  with the original privacy choice and one in-flight upload. See
  `docs-local/notification-redesign/implementation.md` for coverage.

## Chat typography

Appearance → Theme & text keeps **Global UI Scale** as whole-window zoom (100% by
default), including navigation, settings, controls and chat text. **Chat Text Size**
is a separate desktop-local multiplier (100% by
default) on conversation text and the composer editor, including floating and
inline-edit composers.
It does not resize the sidebar, settings, toolbars, media, or pane geometry.
Navigation, session/project titles and the account name use the shared 14px body
role. Dates and supporting metadata retain the 12px caption role. Maximizing the
window changes available space; the remembered global scale controls its size.
Conversation size and line-height tokens are derived inside the transcript/editor
from their root base tokens; do not multiply the global tokens or nest CSS zoom.
`aino-theme.css` owns those base tokens through the existing 14/13/12px roles;
the inner transcript/editor derives scaled values from them. Do not override only
the final aliases on an outer chat surface: inner scopes recalculate them.

The composer keeps verified model labels and capability controls in place while
the same account's model catalog refreshes during send. Only presentation may
read the retained catalog during loading; request preparation still requires a
ready catalog. Account, backend-origin and revision changes invalidate that copy.

## Chat, tools & boot surfaces

- The transcript and composer are built on `@assistant-ui/react`. Extend the
  existing components under `src/components/assistant-ui` and
  `src/app/chat/composer`; do not fork a second markdown, message, tool-call, or
  approval renderer for one feature.
- Conversation thinking is a compact disclosure row without a full-width
  divider. Reasoning has its own disclosure and never opens as a side effect
  of expanding a tool group. Adjacent ordinary tool calls share one summary;
  reasoning and public progress each end that tool group. Opening a group
  reveals only its flat, same-column tool rows. Command output opens separately
  on the individual row. Public updates and findings stay in chronological order
  between groups; do not derive them from private reasoning or invent them for
  historical turns without public updates. Adjacent activity rows use compact
  spacing; public paragraphs retain the larger stage gap. Expanded reasoning is a bounded,
  scrollable detail at 14px, separated from public prose by its bounded surface. Its disclosure
  identity is independent from the removed aggregate activity fold.
  Expanded terminal details reuse the shared code surface as a bounded Shell
  panel: original command, non-wrapping output, copy, and a bottom status line.
  Long output scrolls and expands without stretching the conversation; background
  launch receipts never imply successful process completion.
  Activity uses readable medium-grey text at full opacity, with slightly
  smaller icons and type than prose. File targets retain a fine underline;
  inline commands use monospace and truncate within the row. Group summaries
  count commands instead of repeating the current command from the ticker.
  Completed timing
  and result counts live in the existing detail disclosure. Public paragraphs
  use regular weight and comfortable line height; compact tool rows use
  regular weight and the shared line-height and glyph columns. At the normal
  desktop scale, prose and user bubbles are 14px, activity uses the 13px UI role
  and shared conversation line height, and glyphs are 14px in a 16px cell.
  Prose uses 1.6 line height; headings scale from the reading size
  (18/16/14px for h1/h2/h3 at that scale). The approved reply presentation uses a
  neutral soft user bubble, a faint shared table-header fill and continuous
  unboxed prose. Disclosure carets sit immediately
  after their label, with width reserved while hidden. They appear on that
  toggle's hover or keyboard focus; touch inputs retain a visible affordance.
  Independent row actions stay outside the toggle. Native thinking keeps
  its full content behind a fine vertical guide; code surfaces use a hairline
  border and retain their copy, scrolling and expansion controls. Markdown
  source fences (`md` / `markdown`) keep their literal syntax in the shared
  code card, with a compact Markdown header and a visible, localized copy action.
  Copy preserves the source document verbatim. Rendered Markdown
  tables keep declared alignment, horizontal scrolling and column resizing;
  visual styling never guesses numeric columns or rewrites model content.
  Reply diagnostics start collapsed behind the existing usage disclosure;
  token totals, context, throughput, cache and session timing remain available
  there, including zero values and totals-only history. Duration (unless already
  in the process header), cost status and the billing-detail action share one
  quiet, wrapping footer with the existing message actions. Pointer hover and
  keyboard focus reveal those actions without changing their footprint; touch
  inputs keep them visible. Non-Aino model disclosures stay visible.
  Expanded reply metrics use one light, wrapping detail surface. The existing
  compact billing list pairs model/amount above purpose/status/time; its
  statuses, full amounts, retry conditions and account-history table are unchanged.
  These are one presentation system, not per-answer modes or length-based rules.
  Activity rows use the existing 4px scaffold gap, prose/stages use 12px, and
  the reply footer has 8px clearance. Hidden process parts contribute no
  inter-block margin. Process headers group through spacing, without a full-width
  rule; nested thinking/tool headers do not introduce dividers.
  Mockup screenshot pixels must not be
  copied into CSS sizes without accounting for capture density. Questions, approvals, failures, file edits, generated outputs and
  registered tool interfaces retain their own surfaces. The live label follows
  the actual pending tool; model waits belong to the existing tail status row.
  While awaiting approval the process reports completed activity only.
  Completed groups summarize recorded
  activity without claiming the task is complete. This is a presentation rule,
  never a rewrite of transcript history or model context.
  Running responses flow directly through progress paragraphs and activity
  rows, without a second process heading or divider. After completion, one
  plain disclosure can fold the response activity; explicit user choices
  survive subsequent running/completed transitions.
  The header reports the recorded turn duration, or simply "Activity" when
  no duration is available. Explicit final text stays outside the collapsed
  process; progress and tool detail retain their chronological order inside.
  Display-only phase metadata follows existing live events and history
  hydration. Explicit previews keep their source phase: process previews fold
  with the process after a reload, while final previews remain with the answer.
  Interrupted partial text is never inferred to be a final answer.
  Errors, input/consent and dedicated result surfaces keep the response open.
  Delegated agents use compact status disclosures with their existing details
  and controls available on expansion. Live updates join the dispatch by child,
  batch or tool-call identity, never by matching goals or task counts. A dispatch
  receipt does not establish that its background children completed.
  The turn pair owns the user-to-assistant gap. The reply footer
  appears only after its turn stops running, including gaps
  between text and tool calls. Only the live tail's pending footer reserves
  layout space. A hidden footer before continuing response messages has no
  footprint; its controls stay mounted and return when the turn stops.
  Pending footers remain hidden and inert; earlier completed replies keep their controls.
  Manual and automatic context compression share one neutral status row after
  the latest conversation records, above the composer. It stays visible for
  idle manual compression and pending background work, follows its own session,
  and yields to normal activity when compression ends. Message-level thinking
  indicators stay quiet during compression. Progress and successful manual
  results do not produce corner toasts; the result uses the existing inline
  command output. Historical pages do not carry the live compression indicator.
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
  The home order is localized heading and subtitle → project selector above the input →
  composer controls → the four existing quick tasks. The centered composition
  caps at 864px; the home composer starts at 192px high, uses 20px corners, and
  quick-task actions use 6px control corners. Quick-task labels use the 13px UI
  role; the home editor starts at 14px and retains
  the saved chat text scale. Its project footer has a 44px minimum height and
  13px labels, with inline padding aligned to the editor. Short windows use a
  160px composer and tighter cards.
  The reserved slot and actual composer share one height, and the editor scrolls
  above its controls for long drafts. Task columns respond to the available chat
  pane width, and short windows use a more compact composer and spacing. The heading uses the same sans family as the UI. The sidebar carries the existing
  Aino mark, while the Sessions/Agent Hub switch and all navigation remain available.
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
  metadata, never injected into model context. Plugin status controls live in
  Settings ▸ Plugins. Webhooks open from Gateway settings, subtask
  monitoring from Agent Hub; scheduled jobs and terminal keep their navigation.
  Versions and updates live in Settings.
- Files, previews, Browser, Terminal, Review and explicitly opened Logs share one
  tool group backed by the existing pane tree. Its plus opens a localized new-tab
  chooser, with a discoverable tab list, maximize/restore and full-panel hide.
  The tool-only PaneTabStrip variant is 45px high with 32px tabs, 3px gaps,
  7px fully rounded selected outlines, 12px labels and 14px lead icons; other
  custom tab strips retain their existing geometry.
  Hide releases all of that group's width and keeps its selected tab and live
  resources. Every safe tool-only group uses this chrome, including an unmarked
  group created by dragging; minimized tools never leave a vertical header rail.
  Restored tool-only decks consolidate into the Files host, otherwise an existing
  marked or first safe host, preserving its selected tab and hidden state. Old
  migration flags, custom preset IDs and user-placed pins do not bypass this
  upgrade. Applying a preset uses the same normalization; known legacy bundled
  decks extract core tools from their chat/navigation stack. Unknown plugin and
  mixed chat groups retain their own layout. No dismissed resource is reopened.
  Summary remains inside its conversation. Single-click file peeks are temporary;
  double-click or Keep tab preserves them within their owner session. Pin to
  workspace remains an explicit separate cross-session action. Dirty editors stay
  mounted across tool switches, hide and session changes. Closing offers Cancel,
  Discard changes and Save and close using the editor's existing save, source and
  on-disk conflict checks. Project file search reuses scoped path completion;
  a delayed result from another source/session cannot open a local path.
- Explicit tool entry points use one docking action: the originating safe tool
  group wins, followed by Files and the existing safe host. Review keeps the
  current tool session's repository and composer target. Background readiness
  and passive restoration never change the saved selected tab or steal focus.
  Narrow windows show one overlay for the shared group with the same tab strip,
  chooser, list and hide actions. Visible tab selection also updates keyboard
  ownership; the selected chip scrolls into the strip's viewport through the
  existing active-tab visibility helper. Closing a narrow tool uses the same
  resource owner and dirty-file confirmation as docked tabs, selecting the
  remaining active sibling only after the close succeeds. Terminal, Browser and
  editor bodies remain single live instances.
  Narrow reveals use the existing idempotent open intent; opening a target hidden
  by another group's maximize releases only that maximize. Review content starts
  directly under the shared tab strip, without another titlebar or self-title.
  Scope and Git actions remain available; file list and selected virtualized
  diff receive actual flex height and scroll independently above the fixed ship
  controls. The changed line must be visibly inside its viewport, not merely
  present in the DOM.
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
- Generated image results show verified output pixels separately from requested
  dimensions, including replayed results. A mismatch preserves the original image
  and is explained inline; requested sizes never stand in for unknown output.
  Per-turn and account receipts use the API's image size, tier, breakdown and
  size source. Quality labels are not billing tiers; missing historical evidence
  remains unknown and the renderer never recalculates a charge.
- Tool rows reserve destructive red for explicit failures. Missing read paths and
  ambiguous exit-1 results use neutral notices, with details still available.
  Errors described inside returned data are not tool failures. Expanded failures
  show the actual explanation; supporting output keeps its normal text color.
  A collapsed live run shows the newest pending tool on its own ticker line,
  even when a later parallel tool finishes or fails first. Clipped rows stay
  mounted but leave keyboard and screen-reader navigation. Long labels
  truncate within the available width, keeping the disclosure visible. Collapsing
  a run after reading a tool's details keeps its header in the ticker window;
  one click restores those details without losing the saved disclosure choice.
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
- Guide startup has a dedicated landing screen with the shared long-operation
  Loader and a localized startup label. It remains active until the guide's
  saved conversation is loaded. No greeting, composer, Skip setup, or statusbar
  appears early. Reduced motion uses a static BrandMark and the same label.
  On readiness, reveal the real conversation and fade controls in over 100ms.
  Never fabricate progress, delay readiness for motion, or replace a resumed
  conversation with a new greeting.
- Respect `AppShell` overlay ownership. Persistent terminal/content layers,
  route overlays, dialogs, and boot surfaces must not compete through ad-hoc
  z-index literals. Pick a rung of the ladder in `styles.css` instead —
  `--z-modal-backdrop` / `--z-modal` / `--z-modal-popover`, `--z-over-modal`
  (toasts, tooltips, command surfaces) and `--z-over-modal-content`,
  `--z-switcher-backdrop` / `--z-switcher`, then the boot chain
  `--z-connecting` → `--z-onboarding` → `--z-setup` → `--z-crash`. Plain
  `z-10`/`z-20` are still right for stacking *within* one component.

## Iconography & brand

- **Codicons** supplies 128 official SVG geometries from `@vscode/codicons`
  0.0.45 for application/chrome icons. Eight symbols without a semantic
  equivalent retain their IconPark source, normalized into the same 16-unit
  viewport with one-pixel optical strokes at 16px; they are not official Codicons.
  Import the existing curated aliases and `iconSize` scale from `src/lib/icons.ts`;
  feature code must not import another icon package. Static paths, licenses and
  exact source mappings live in `src/assets/aino-icons/`, including
  `codicon-provenance.json`; navigation masks use that same geometry.
- **`Codicon`** preserves the editor/plugin name API. Common application names
  render the same approved SVGs through `src/components/ui/codicon.tsx`, including
  `codiconIcon()` for component-shaped consumers. Specialized editor/Git names
  and unknown extension names retain their established fallback vocabulary.
- Reuse the existing semantic icon for an action across pages, menus and dialogs.
  Do not substitute decorative shapes for distinct actions. Provider/platform
  brands, user avatars, file-language art and specialized Git/resource diagrams
  retain their own identities.
- **`BrandMark`** (`src/components/brand-mark.tsx`) is the Aino brand glyph — a
  small vector mark, softly rounded and identical in light/dark. Use it for
  explicit brand moments and the approved sidebar mode selector. The home
  headline has no decorative app glyph. Do not reintroduce star/sparkle icons.
- Account sign-in retains its existing `assets/aino-account/logo.png` artwork,
  AINO heading, 80px logo and centered input/actions. Secondary login links
  share a centered, wrapping footer row to avoid stacking three small actions.
  Keep the established form order and control geometry. Phone registration
  has one short visible hint; the existing-account binding explanation is
  available through its small sign-in help button. The native 340 CSS-pixel
  account window remains content-sized. Scope: simplify hints, preserve layout.
  Switching methods clears old form errors while capability failures retain
  recovery; auth loading locks navigation and TOTP Back returns to its entry.
  See `docs-local/login-simplification/DESIGN.md`.

## Motion

- Visible windows keep animating when another app takes focus. Hidden/minimized
  windows and inactive panes may pause; background polling stays focus-gated.
- Animated integer counts reuse `AnimatedInt` in `src/components/ui/diff-count.tsx`.
  Its spring updates the DOM directly without per-frame React renders.
- Quick, functional transitions (~100ms on controls). Respect
  `prefers-reduced-motion` for anything beyond a fade.
- Hover paints instantly; only the return eases. Put the transition on the
  resting state and drop it while hovered (`transition-colors duration-100
  hover:transition-none`, or the CSS equivalent on `:hover`). A group that
  dims siblings goes instant too. Exceptions are named, e.g. the catalog
  card's arc border fades in and out.
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
- Zone tabs have one keyboard entry point at the selected tab. Arrows follow
  the strip's orientation; Home/End move focus, Enter/Space activate, and Tab
  leaves the tabs. Delete invokes an available close action and retains focus
  on a surviving sibling. Restoring a vertical rail retains its tab focus.
  The collapsed rail keeps the zone context menu on its outer surface; its
  inner tab list owns vertical keyboard navigation.
- Tab-header focus belongs to navigation: session activation and queued composer
  focus retries must not redirect it. Explicit composer focus still works.
  Entering a split's tab strip selects its visible chat as the typing recipient
  without moving focus into the editor; hidden tabs must not receive that input.
- Sidebar keyboard stops are real controls: session title, reorder handle and
  actions, not timestamps. Focus uses existing theme tokens, stays distinct from
  selection, and reveals hover-only controls. Focused/open actions replace their
  metadata tail; real metadata actions remain independently reachable.
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
- **Update all locales together** — every catalog registered in
  `src/i18n/catalog.ts`. A string change in `en.ts` that skips the others is a
  regression (drifted punctuation, stale labels). Keep trailing-punctuation and
  tone consistent across all of them. `fr`, `de`, and `es` are complete
  `Translations` objects, so a key missing there fails the type check; the
  `defineLocale()` overlays fall back to English instead.
- **Sparse locales** (`ar`, `ru`) override the English base through
  `defineLocale()`. Large catalogs are split by topic: the Arabic source lives
  in `src/i18n/ar_<topic>.ts`, recomposed by `src/i18n/ar.ts`.

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
- Keep keyboard focus visible through existing control primitives and theme
  tokens; never globally suppress outlines or focus rings. Preserve native
  focus indicators on controls without a themed replacement. Titlebar actions
  have no active-background state.
- Each control has one focus treatment: its existing ring, outline, or field
  border. Suppress the native outline only when that replacement is visible.
  In forced-colors mode, use one system-color outline on the focused control
  (or its field wrapper); don't outline unfocused menu rows or containers.
  Keep command-picker input and selected-row fallback outlines inset so scroll
  and group clipping cannot cut off their edges.
  Inline message editors delegate focus chrome to their card border, just like
  the main composer; their inner contenteditable must not add a second outline.
- Keyboard users can activate image viewers and return to their available
  opener when the viewer closes. Composer focus-follow must preserve focus
  returning from a floating layer while updating the owning chat surface.
- An open `titlebar-popover` trigger identifies its floating or docked card.
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
- [ ] All registered locales updated for any new/changed string?
- [ ] `cursor-pointer`, focus ring, and `Esc`-to-close behave?
- [ ] Touched a primitive, token, or variant? Its named-contract entry in this
      file is updated in the same change.
