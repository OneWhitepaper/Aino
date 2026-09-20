import { useStore } from '@nanostores/react'
import { atom, computed } from 'nanostores'
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from 'react'
import { useLocation } from 'react-router'

import { SessionDraftTitle } from '@/app/chat/session-draft-title'
import { SessionStatusDot } from '@/app/chat/session-status-dot'
import { PALETTE_AREA, type PaletteContribution, paletteToggle } from '@/app/command-palette/contrib'
import { useConnectionRegistry } from '@/app/gateway/hooks/use-connection-registry'
import { type StatusbarItem } from '@/app/shell/statusbar-controls'
import { SummaryWorkspace } from '@/app/shell/summary-workspace'
import { TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import tabSessionsIcon from '@/assets/aino-home/tab-sessions.svg'
import { AinoDesignIcon } from '@/components/aino-design-icon'
import { AskDirective } from '@/components/assistant-ui/ask-directive'
import { InlinePreviewDirective } from '@/components/assistant-ui/inline-preview-directive'
import { IdleMount } from '@/components/idle-mount'
import { OnboardingChatDirective } from '@/components/onboarding-chat/directive'
import { $layoutEditMode, toggleLayoutEditMode } from '@/components/pane-shell/edit-mode'
import { allPaneIds, findGroupOfPane, groupLeafIds, movePane, setActivePane } from '@/components/pane-shell/tree/model'
import { LayoutTreeRoot } from '@/components/pane-shell/tree/renderer'
import { WindowTitlebarContext } from '@/components/pane-shell/tree/renderer/header-placement'
import {
  $activePresetId,
  $layoutTree,
  $userPlacedPanes,
  activateTreePane,
  bindPaneVisibility,
  bindTreeSideVisibility,
  declareDefaultTree,
  dismissTreePane,
  isPaneVisible,
  markCollapsePane,
  mirrorLayoutTree,
  paneRootSide,
  persistTree,
  registerLayoutResetHandler,
  registerPaneCloser,
  registerPaneOpener,
  removeTreePane,
  resetLayoutTree,
  revealTreePane,
  setStripTabHidden,
  targetZoneTabStripVisible,
  togglePaneVisible,
  toggleTargetZoneTabStrip,
  watchContributedPanes
} from '@/components/pane-shell/tree/store'
import { $workspaceOwnerLabels, workspaceOwnerTitle } from '@/components/pane-shell/workspace-scope'
import { SidebarProvider } from '@/components/ui/sidebar'
import { discoverBundledPlugins } from '@/contrib/plugins'
import { Slot } from '@/contrib/react/slot'
import { useContributions } from '@/contrib/react/use-contributions'
import { registry } from '@/contrib/registry'
import { discoverRuntimePlugins } from '@/contrib/runtime-loader'
import { translateNow } from '@/i18n'
import { newSessionTitle, sessionTitle as storedSessionTitle } from '@/lib/chat-runtime'
import { Download, FileText, LayoutDashboard, PanelTop, Terminal, Upload, Zap } from '@/lib/icons'
import { type KeybindContribution, KEYBINDS_AREA } from '@/lib/keybinds/actions'
import { isOnboardingEnabled } from '@/lib/onboarding-enabled'
import { readKey, writeKey } from '@/lib/storage'
import { TRANSCRIPT_DIRECTIVE_AREA, type TranscriptDirectiveContribution } from '@/lib/transcript-directives'
import { setYoloEnabled } from '@/lib/yolo-session'
import { pruneComposerPopoutZones } from '@/store/composer-popout'
import {
  $fileBrowserOpen,
  $panesFlipped,
  $sidebarOpen,
  FILE_BROWSER_DEFAULT_WIDTH,
  FILE_BROWSER_MAX_WIDTH,
  FILE_BROWSER_MIN_WIDTH,
  setFileBrowserOpen,
  setSidebarOpen,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH
} from '@/store/layout'
import { runExportProfileFlow, runImportProfileFlow } from '@/store/profile-share'
import { $reviewOpen, $reviewRepoCwd, closeReview, restoreReview, REVIEW_PANE_ID } from '@/store/review'
import { $selectedStoredSessionId, $sessions, $yoloActive, sessionMatchesStoredId } from '@/store/session'
import { watchSessionPins } from '@/store/session-pin-sync'
import { $botChatScopes } from '@/store/session-states'
import { watchUnreadWriteGuard } from '@/store/session-unread-remote'
import { $toolWorkspaceCwd } from '@/store/tool-session'
import { isAuxiliaryWindow, isBrowserWindow, isHudWindow } from '@/store/windows'

import { BrowserPopoutShell } from '../chat/browser-popout-shell'
import type { SessionDragPayload } from '../chat/composer/inline-refs'
import { watchPreviewTiles } from '../chat/preview-tile'
import { watchRouteTiles } from '../chat/route-tile'
import { startSessionDrag } from '../chat/session-drag'
import {
  SessionTileCloseConfirm,
  stackSessionTilesIntoMain,
  startUnrestoredTileTitleBackfill,
  watchSessionTiles,
  WorkspaceHeaderMenu,
  WorkspaceTabMenu
} from '../chat/session-tile'
import { AppContextMenu } from '../context-menu/app-context-menu'
import { HudShell } from '../hud/hud-shell'
import { $terminalTakeover, setTerminalTakeover } from '../right-sidebar/store'
import { $workspaceIsPage, appViewForPath } from '../routes'

import { DEFAULT_TREE, registerLayoutPresets } from './layout-presets'
import { FilesPane, LogsPane, ReviewPaneContent } from './panes'
import { ContribWiring, WiredPane } from './wiring'

/**
 * Stripped-down app root (bb/contrib-areas) on the layout TREE model, mounting
 * the REAL app surfaces. The title bar and status bar sit OUTSIDE the grid
 * (fixed chrome) but are fully composable: title bar renders `titleBar.left/
 * right` slots; the status bar consumes `statusBar.left/right` DATA
 * contributions (payload = StatusbarItem). Core registers its items through
 * the same calls a plugin would use.
 */

// ---------------------------------------------------------------------------
// Pane contributions. `data.placement` = semantic role for grid presets;
// `data.minWidth/maxWidth/minHeight/maxHeight` = the SAME clamps the app's
// `Pane` props declare — the layout tree sizes zones by weight (percentage)
// but a zone never shrinks/grows past its active pane's clamp.
// Headers are contextual (tree-side): a pane alone in a zone shows no
// header/tab by default; stacked panes show chips. Double-click a zone
// toggles its header either way.
// ---------------------------------------------------------------------------

// ONE render identity for the workspace pane — syncWorkspaceTitle re-registers
// the contribution (new title) and a fresh closure would remount the chat.
const renderWorkspacePane = () => <WiredPane part="chatRoutes" />

// Boot-hidden panes mount behind display:none (instant-toggle contract) — defer
// them to idle so they're off the first-paint path, warm before reveal.
const idle = (node: ReactElement) => <IdleMount>{node}</IdleMount>
// The main tab carries the same session context menu as tile tabs (targets
// the loaded primary session; no menu on a fresh draft).
const wrapWorkspaceTab = (tab: ReactElement) => <WorkspaceTabMenu>{tab}</WorkspaceTabMenu>

/** The `@session` payload for the workspace tab — the loaded primary session,
 *  or null on a fresh draft / full-page view (nothing to link). */
const workspaceDragPayload = (): SessionDragPayload | null => {
  const selected = $selectedStoredSessionId.get()

  if (!selected || $workspaceIsPage.get()) {
    return null
  }

  const stored = $sessions.get().find(s => sessionMatchesStoredId(s, selected))

  return { id: selected, profile: stored?.profile ?? '', title: stored ? storedSessionTitle(stored) : '' }
}

// The main tab drags like a session tile — drop it on a composer to link the
// chat, on a zone/edge to stack/split. Defers (`false`) to the generic pane
// move when there's no loaded session to carry.
const workspaceTabDrag = (event: ReactPointerEvent<HTMLElement>, onTap: () => void) => {
  const payload = workspaceDragPayload()

  if (!payload) {
    return false
  }

  startSessionDrag(payload, event, { onTap })

  return true
}

registry.registerMany([
  {
    id: 'sessions',
    area: 'panes',
    title: 'sessions',
    // Collapsible: leaves the grid on narrow viewports (edge overlay instead).
    // dock: where a RE-ADOPTED pane lands (healed from a stale dismissal) —
    // its default-ish spot beside main, not a random same-placement stack.
    data: {
      placement: 'left',
      collapsible: true,
      dock: { pane: 'workspace', pos: 'left' },
      revealAliases: ['chat-sidebar'],
      // Standing chrome: no close gestures at all — the tab is shown/hidden
      // (zone menu Show/Hide rows + the auto-registered ⌘K toggle below).
      hideOnly: true,
      tabLead: () => <AinoDesignIcon className="size-3.5" src={tabSessionsIcon} />,
      width: `${SIDEBAR_DEFAULT_WIDTH}px`,
      minWidth: `${SIDEBAR_DEFAULT_WIDTH}px`,
      maxWidth: `${SIDEBAR_MAX_WIDTH}px`
    },
    render: () => <WiredPane part="sidebar" />
  },
  {
    id: 'workspace',
    area: 'panes',
    // Live-retitled to the loaded session by syncWorkspaceTitle below.
    title: newSessionTitle(),
    data: {
      placement: 'main',
      minWidth: '22vw',
      tabDrag: workspaceTabDrag,
      tabWrap: wrapWorkspaceTab,
      headerMenu: () => <WorkspaceHeaderMenu />,
      uncloseable: true
    },
    render: renderWorkspacePane
  },
  {
    id: 'terminal',
    area: 'panes',
    title: 'terminal',
    // revealOnPreset: choosing a layout that places the terminal (e.g.
    // "Terminal deck") turns takeover on so the zone actually shows, instead of
    // staying hidden behind the ⌃` toggle. height sizes the fixed track (a
    // single-pane zone declaring a height is a fixed track — the preset weight
    // is moot): a short deck, not a third of the window.
    //
    // NO minHeight: a tool panel drags all the way down to its collapsed
    // header (the sash floors it at COLLAPSED_ZONE_PX and folds the zone to
    // its rail there). A real floor left a sliver of unusable terminal.
    data: {
      placement: 'bottom',
      dock: { pane: 'workspace', pos: 'bottom' },
      height: '20vh',
      maxHeight: '80vh',
      revealOnPreset: true,
      lifecycleKeepAlive: true,
      selfManagedTabs: true
    },
    render: () => <WiredPane part="terminal" />
  },
  {
    id: 'files',
    area: 'panes',
    title: 'files',
    // dock: re-adoption target after a stale dismissal (see sessions).
    data: {
      placement: 'right',
      collapsible: true,
      dock: { pane: 'workspace', pos: 'right' },
      revealAliases: ['file-browser'],
      width: FILE_BROWSER_DEFAULT_WIDTH,
      minWidth: FILE_BROWSER_MIN_WIDTH,
      maxWidth: FILE_BROWSER_MAX_WIDTH
    },
    render: () => idle(<FilesPane />)
  },
  {
    id: 'review',
    area: 'panes',
    title: 'review',
    // The second right sidebar: hidden until ⌘G ($reviewOpen) — bound below
    // like the other chrome toggles; its zone collapses while hidden.
    data: {
      placement: 'right',
      collapsible: true,
      revealAliases: [REVIEW_PANE_ID],
      width: FILE_BROWSER_DEFAULT_WIDTH,
      minWidth: FILE_BROWSER_MIN_WIDTH,
      maxWidth: FILE_BROWSER_MAX_WIDTH
    },
    render: () => idle(<ReviewPaneContent />)
  }
])

// ---------------------------------------------------------------------------
// Chrome contributions. The title bar and status bar are fixed chrome outside
// the grid, composable through these areas. Everything real lives in the real
// components (TitlebarControls / useStatusbarItems). Sample PLUGIN
// contributions don't live here — they're their own files under `src/plugins/`,
// auto-discovered by discoverBundledPlugins() below.
// ---------------------------------------------------------------------------

registry.registerMany([
  // Titlebar center stays empty on purpose: session title lives in tabs +
  // sidebar; place/cwd lives in the sidebar project tree. Center is drag
  // chrome (plugins can still contribute to titleBar.center if needed).
  // Layout edit mode registers through the SAME declarative surfaces plugins
  // use: a rebindable keybind (collision-checked in the panel) + a ⌘K row
  // whose hotkey hint tracks the live binding.
  {
    id: 'layout.editMode',
    area: KEYBINDS_AREA,
    data: {
      id: 'layout.editMode',
      label: 'Toggle layout edit mode',
      defaults: ['mod+shift+\\'],
      run: toggleLayoutEditMode
    } satisfies KeybindContribution
  },
  paletteToggle({
    id: 'layout.editMode',
    label: 'Toggle layout edit mode',
    action: 'layout.editMode',
    icon: LayoutDashboard,
    keywords: ['layout', 'zones', 'panes', 'edit', 'rearrange'],
    get: () => $layoutEditMode.get(),
    set: enabled => $layoutEditMode.set(enabled)
  }),
  // The agent's write -> see loop: rescan <hermes home>/desktop-plugins
  // without relaunching (same-id reloads dispose the previous incarnation).
  {
    id: 'plugins.reload',
    area: PALETTE_AREA,
    data: {
      id: 'plugins.reload',
      label: 'Reload desktop plugins',
      keywords: ['plugins', 'reload', 'refresh', 'desktop'],
      run: () => void discoverRuntimePlugins()
    } satisfies PaletteContribution
  },
  // The core `::preview{file="…"}` transcript directive — the model (or a
  // skill) renders a workspace HTML file LIVE inside its own message
  // (sandboxed srcdoc iframe; falls back to the classic preview card for
  // non-HTML targets and remote gateways). Also the reference consumer for
  // the `transcript.directives` area plugins register into.
  {
    id: 'transcript.preview',
    area: TRANSCRIPT_DIRECTIVE_AREA,
    data: {
      name: 'preview',
      render: ({ attrs, streaming }) => <InlinePreviewDirective attrs={attrs} streaming={streaming} />
    } satisfies TranscriptDirectiveContribution
  },
  ...(isOnboardingEnabled()
    ? [
        {
          id: 'transcript.onboarding',
          area: TRANSCRIPT_DIRECTIVE_AREA,
          data: {
            name: 'onboarding',
            render: ({ attrs, streaming }) => <OnboardingChatDirective attrs={attrs} streaming={streaming} />
          } satisfies TranscriptDirectiveContribution
        },
        // ::ask is the guided chat's question card, registered only with the
        // onboarding flag. B4 decides its wider use.
        {
          id: 'transcript.ask',
          area: TRANSCRIPT_DIRECTIVE_AREA,
          data: {
            name: 'ask',
            render: ({ attrs, streaming }) => <AskDirective attrs={attrs} streaming={streaming} />
          } satisfies TranscriptDirectiveContribution
        }
      ]
    : []),
  {
    id: 'layout.reset',
    area: PALETTE_AREA,
    data: {
      id: 'layout.reset',
      label: 'Reset layout',
      icon: LayoutDashboard,
      keywords: ['layout', 'reset', 'default', 'panes'],
      run: resetLayoutTree
    } satisfies PaletteContribution
  },
  paletteToggle({
    id: 'view.toggleTabStrip',
    label: 'Toggle tabs',
    action: 'view.toggleTabStrip',
    icon: PanelTop,
    keywords: ['tab strip', 'tab bar', 'tabs', 'header', 'zone', 'hide', 'show', 'chrome'],
    // On-screen truth for the zone the verbs target, not a stored flag: a zone
    // on auto has no stored value, and the row must read as "what pressing
    // this does to what I can see".
    get: () => Boolean(targetZoneTabStripVisible()),
    set: () => void toggleTargetZoneTabStrip()
  }),
  // The keybind panel's non-titlebar door (the keyboard icon is gone).
  {
    id: 'keybinds.panel',
    area: PALETTE_AREA,
    data: {
      id: 'keybinds.panel',
      label: 'Keyboard shortcuts',
      keywords: ['keybinds', 'shortcuts', 'hotkeys', 'keyboard'],
      run: () => window.dispatchEvent(new CustomEvent('hermes:open-keybinds'))
    } satisfies PaletteContribution
  },
  // Profile sharing: bundle the active profile (config, skills, theme, layout)
  // into a portable archive, or adopt someone else's. Both open native dialogs,
  // so the palette closing on select is correct.
  {
    id: 'profile.export',
    area: PALETTE_AREA,
    data: {
      id: 'profile.export',
      label: 'Export profile…',
      icon: Upload,
      keywords: ['profile', 'export', 'share', 'bundle', 'theme', 'settings', 'backup'],
      run: () => void runExportProfileFlow()
    } satisfies PaletteContribution
  },
  {
    id: 'profile.import',
    area: PALETTE_AREA,
    data: {
      id: 'profile.import',
      label: 'Import profile…',
      icon: Download,
      keywords: ['profile', 'import', 'share', 'bundle', 'archive', 'restore'],
      run: () => void runImportProfileFlow()
    } satisfies PaletteContribution
  }
])

registerLayoutPresets()

declareDefaultTree(DEFAULT_TREE)

// Summary now floats from the titlebar. Retire only its old persisted pane;
// saved terminal, session and plugin arrangements remain user-owned.
if ($layoutTree.get() && allPaneIds($layoutTree.get()!).includes('summary')) {
  removeTreePane('summary')
}

// Migrate the old default and the legacy navigation tab once. Future custom
// placements remain user-owned; no other pane or size preference is reset.
const TERMINAL_WORKSPACE_MIGRATION = 'aino.desktop.terminalWorkspace.v1'

if (!isAuxiliaryWindow() && !readKey(TERMINAL_WORKSPACE_MIGRATION)) {
  const tree = $layoutTree.get()
  const workspace = tree && findGroupOfPane(tree, 'workspace')
  const terminal = tree && findGroupOfPane(tree, 'terminal')
  const legacyNavigationTab = terminal?.panes.includes('sessions') || terminal?.panes.includes('hermes-bots:pane')
  const oldDefault = $activePresetId.get() === 'default' && !$userPlacedPanes.get().has('terminal')

  if (tree && workspace && (legacyNavigationTab || oldDefault)) {
    let next = movePane(tree, 'terminal', { groupId: workspace.id, pos: 'bottom' })

    // Removing the active terminal must not activate the adjacent Agent Hub
    // tab and change the user's workspace as a side effect of migration.
    if (terminal?.active === 'terminal' && terminal.panes.includes('sessions')) {
      next = setActivePane(next, terminal.id, 'sessions')
    }

    if (next !== tree) {
      $layoutTree.set(next)
      persistTree()
    }
  }

  writeKey(TERMINAL_WORKSPACE_MIGRATION, '1')
}

// Bundled plugins load AFTER core, so a same-id contribution from a plugin
// deliberately overrides the core default (last writer wins). Third-party
// runtime plugins will flow through the same discovery seam.
discoverBundledPlugins()

// Plugin panes join the tree by their `placement` hint the moment they
// register — incl. runtime plugins arriving seconds after boot.
watchContributedPanes()

// Session + route (page) tiles: persisted splits register panes docked beside
// main. A popped-out Browser and the HUD have no layout tree — registering
// tiles there would still run, and preview-tile watching would try to dock
// into a tree this window never renders (and, in the HUD, paint a webview
// into the transparent overlay).
if (!isBrowserWindow() && !isHudWindow()) {
  watchSessionTiles()
  startUnrestoredTileTitleBackfill()
  watchRouteTiles()
  watchPreviewTiles()
}

// Composer pop-out state is keyed by layout zone, so drop entries for zones the
// user has since closed or merged away — otherwise a long-lived install keeps a
// row for every split it has ever had.
$layoutTree.subscribe(tree => {
  if (tree) {
    pruneComposerPopoutZones(groupLeafIds(tree))
  }
})

// Mirror sidebar pins into the backend keep-flag so the auto-archive sweep
// never hides a pinned chat (and pre-existing pins migrate transparently).
watchSessionPins()

// Release unread-write guards once a list page confirms the value we wrote.
watchUnreadWriteGuard()

// The main tab reads as its SESSION (the loaded title, "New session" on a
// fresh draft) — a stack of main + tiles is then just a row of session names.
// register() replaces same-id in place; the render fn is the shared constant
// above, so the pane content never remounts.
const syncWorkspaceTitle = () => {
  const selected = $selectedStoredSessionId.get()
  const stored = selected ? $sessions.get().find(s => sessionMatchesStoredId(s, selected)) : null

  registry.register({
    id: 'workspace',
    area: 'panes',
    // The placeholder, not the draft's live name — `tabTitle` below renders
    // that. Keeping it here would re-register the pane on every keystroke.
    // A bot chat reads as its BOT: every canonical Bot Chat is stored under
    // the same name, which told two open bots apart by nothing (#99152).
    title: workspaceOwnerTitle(
      stored ? storedSessionTitle(stored) : newSessionTitle(),
      selected ? $botChatScopes.get()[selected] : undefined
    ),
    data: {
      // The tab's status dot — the SAME primitive the sidebar row and session
      // tiles render, so the main tab never disagrees with its sidebar row. A
      // fresh draft has no session to key by, which IS its status: the dot
      // resolves to `draft` and marks the tab rather than leaving a hole.
      tabLead: () => <SessionStatusDot session={stored} storedSessionId={selected} />,
      // A draft's name lives in its composer, not in any session row, so the
      // label subscribes to it directly — typing renames the tab without
      // re-registering the pane.
      tabTitle: stored ? undefined : () => <SessionDraftTitle scope={selected} />,
      // Pages aren't tab-able: the main zone's bar stands down while one shows.
      headerVeto: $workspaceIsPage.get(),
      placement: 'main',
      minWidth: '22vw',
      tabDrag: workspaceTabDrag,
      tabWrap: wrapWorkspaceTab,
      // The single-session header's visible ⋯ for the routed session; renders
      // nothing on a fresh draft (no session verbs to offer).
      headerMenu: () => <WorkspaceHeaderMenu />,
      uncloseable: true
    },
    render: renderWorkspacePane
  })
}

$selectedStoredSessionId.listen(syncWorkspaceTitle)
$sessions.listen(syncWorkspaceTitle)
$botChatScopes.listen(syncWorkspaceTitle)
$workspaceOwnerLabels.listen(syncWorkspaceTitle)
$workspaceIsPage.listen(syncWorkspaceTitle)

// Layout reset collapses every session tile into main as a tab (after the
// workspace) instead of re-scattering them — pre-placed before adoption.
registerLayoutResetHandler(stackSessionTilesIntoMain)

// ---------------------------------------------------------------------------
// Titlebar chrome toggles -> tree. The TitlebarControls buttons keep their
// store semantics ($sidebarOpen / $fileBrowserOpen / $panesFlipped); the tree
// reacts — a hidden pane's zone collapses (content stays mounted), the flip
// toggle mirrors the root row.
// ---------------------------------------------------------------------------

// HIDE-STYLE PANES (files, review, preview): the binding lives in the tree
// store — bindPaneVisibility — alongside bindToolPaneCollapse, so both are
// testable against the real function instead of a copy.

// TOOL PANELS (terminal, logs): the binding lives in the tree store —
// bindToolPaneCollapse — so the boot rule it encodes is testable against the
// real function instead of a copy. See its docblock for the semantics.

// SIDES have one source of truth: the TREE. The legacy $panesFlipped flag is
// DERIVED from where the sessions zone actually sits (TitlebarControls maps
// its left/right buttons through it), so dragging sessions across — or
// applying a mirrored preset — remaps the buttons automatically. The flip
// action (⌘\ / titlebar) mirrors the tree only when they disagree.
const sessionsOnRight = () => {
  const tree = $layoutTree.get()

  if (!tree) {
    return null
  }

  const order = allPaneIds(tree)
  const sessions = order.indexOf('sessions')
  const main = order.indexOf('workspace')

  return sessions >= 0 && main >= 0 ? sessions > main : null
}

$layoutTree.subscribe(() => {
  const flipped = sessionsOnRight()

  if (flipped !== null && flipped !== $panesFlipped.get()) {
    $panesFlipped.set(flipped)
  }
})

$panesFlipped.listen(flipped => {
  const current = sessionsOnRight()

  if (current !== null && current !== flipped) {
    mirrorLayoutTree()
  }
})

// POSITIONAL side toggles (titlebar buttons, ⌘B / ⌘J): $sidebarOpen ≙ the
// LEFT side of the main zone, $fileBrowserOpen ≙ the RIGHT — everything on
// that side hides together, whatever panes have been rearranged there.
bindTreeSideVisibility('left', $sidebarOpen, setSidebarOpen)
bindTreeSideVisibility('right', $fileBrowserOpen, setFileBrowserOpen)

// Workspace-scoped surfaces: the file tree and git diff only mean something
// inside a project. A detached chat (no cwd) hides them — their zones
// collapse and the chat absorbs the width; picking a project brings them
// back. The terminal is NOT workspace-gated: unlike the old shell (where it
// rode the rail's row and vanished with it), its zone stands on its own.
const $hasWorkspace = computed($toolWorkspaceCwd, cwd => Boolean(cwd))

// The tree pane's own presence tracks ⌘J directly, not just the column's
// collapse — otherwise a pane revealed into that shared column would drag the
// tree along with it.
//
// Both get a CLOSER and an OPENER. The closer keeps ⌘J/⌘G truthful when the
// pane is closed from the tab menu; the opener is its mirror, so bringing the
// pane back through the tree (the toggle's reveal path, the rail, a preset)
// writes the store too. Without the opener the boolean went stale the moment
// anything but the toggle showed the pane — the divergence this whole change
// is about.
bindPaneVisibility(
  'files',
  computed([$hasWorkspace, $fileBrowserOpen], (workspace, open) => workspace && open),
  () => setFileBrowserOpen(false),
  () => setFileBrowserOpen(true)
)
// ⌘G — the review sidebar appears/disappears (and comes to the front).
bindPaneVisibility(
  'review',
  computed([$reviewOpen, $reviewRepoCwd], (open, cwd) => open && Boolean(cwd)),
  closeReview,
  restoreReview
)
// The titlebar and terminal's own strip provide the restore/close handles.
// Hide the entire pane, while PersistentTerminal retains the live shells.
markCollapsePane('terminal')
bindPaneVisibility(
  'terminal',
  $terminalTakeover,
  () => {
    setTerminalTakeover(false)

    // Focus remains in the chat when terminal shares a tab group (Focus /
    // user-stacked layouts). A hidden terminal must never become the target
    // of Cmd+W or session actions just because it was active before hiding.
    const tree = $layoutTree.get()
    const group = tree && findGroupOfPane(tree, 'terminal')

    if (group?.panes.includes('workspace')) {
      activateTreePane(group.id, 'workspace')
    }
  },
  () => setTerminalTakeover(true)
)
$terminalTakeover.listen(open => {
  if (open) {
    revealTreePane('terminal')
  }
})
// ⌘K door onto the same pane the keybind and statusbar pill flip — was a
// one-way "open" row under Go to, so it never showed on/off and couldn't hide.
// Reads the TREE like every other pane toggle: `$terminalTakeover` stays true
// behind a stacked sibling tab or a minimized zone, which would light the row
// "on" for a terminal that isn't on screen.
registry.register(
  paletteToggle({
    id: 'view.showTerminal',
    label: 'Toggle terminal',
    action: 'view.showTerminal',
    icon: Terminal,
    keywords: ['terminal', 'shell', 'console', 'pty'],
    get: () => isPaneVisible('terminal'),
    set: () => togglePaneVisible('terminal')
  })
)

// Logs are ⌘K-ONLY chrome: the pane contribution EXISTS only while $logsOpen
// is on. Off (the default) keeps logs out of the registry and the tree
// entirely — no secondary tab riding the terminal strip, no preset or
// adoption path that resurrects it. Session-only on purpose (not persisted):
// a fresh boot never re-opens logs automatically. The palette toggle is the
// single door in; tab ✕ / ⌘W / the toggle itself remove it again.
const $logsOpen = atom(false)

let unregisterLogsPane: (() => void) | null = null

const syncLogsPane = (open: boolean) => {
  if (open) {
    unregisterLogsPane ??= registry.register({
      id: 'logs',
      area: 'panes',
      title: 'logs',
      // Same tool-panel sizing rule as the terminal above — no minHeight, so
      // the sash floors it at COLLAPSED_ZONE_PX and folds the zone to its rail
      // rather than leaving a sliver. dock: its OWN zone beside the terminal —
      // never a tab in the terminal's strip.
      data: {
        placement: 'bottom',
        dock: { pane: 'terminal', pos: 'right' },
        height: '20vh',
        maxHeight: '80vh'
      },
      render: () => idle(<LogsPane />)
    })
    // Summoning logs is explicit intent — front it (un-dismisses if a ✕ close
    // left a dismissal record behind).
    revealTreePane('logs')
  } else {
    unregisterLogsPane?.()
    unregisterLogsPane = null

    // No dismissal record — the next toggle-on must re-adopt cleanly. Also
    // sweeps 'logs' out of persisted trees from before it was summon-only.
    // Guarded: removePane rebuilds the tree even for an absent pane, and a
    // no-op boot sweep would commit (and persist) a fresh identical tree.
    const tree = $layoutTree.get()

    if (tree && allPaneIds(tree).includes('logs')) {
      removeTreePane('logs')
    }
  }
}

// Tool-panel tab semantics (✕ / ⌘W route through the store) so the palette
// toggle stays truthful either way.
markCollapsePane('logs')
registerPaneCloser('logs', () => $logsOpen.set(false))
registerPaneOpener('logs', () => $logsOpen.set(true))
syncLogsPane($logsOpen.get())
$logsOpen.listen(syncLogsPane)

registry.register(
  paletteToggle({
    id: 'logs.toggle',
    label: 'Toggle logs',
    icon: FileText,
    keywords: ['logs', 'agent log', 'tail', 'debug'],
    // On-screen, not the store's boolean. Summon-only keeps the two in step
    // while logs sits in its own zone, but the user can still drag it into the
    // terminal's strip or minimize its zone — and then `$logsOpen` reads true
    // with nothing visible, so the row would show "on" and its press would
    // spend itself re-asserting a value it already held.
    get: () => isPaneVisible('logs'),
    set: () => togglePaneVisible('logs')
  })
)

// Hide-only chrome tabs (sessions / Bots) get a ⌘K toggle each — the palette
// door onto the same show/hide the zone menu offers. Auto-registered from the
// panes area so a plugin's hideOnly pane (Bots registers at plugin load, after
// this module runs) gets its row for free; disposers keep it in step when a
// plugin unloads. Registry writes during a subscriber callback are safe (the
// registry snapshots per-area and re-notifies), and re-registering the same
// palette id replaces the row instead of stacking duplicates.
{
  const stripTabToggles = new Map<string, () => void>()

  const syncStripTabToggles = () => {
    const hideOnlyPanes = registry
      .getArea('panes')
      .filter(c => (c.data as { hideOnly?: boolean } | undefined)?.hideOnly)

    const wanted = new Set(hideOnlyPanes.map(c => c.id))

    for (const [paneId, dispose] of stripTabToggles) {
      if (!wanted.has(paneId)) {
        dispose()
        stripTabToggles.delete(paneId)
      }
    }

    for (const pane of hideOnlyPanes) {
      if (stripTabToggles.has(pane.id)) {
        continue
      }

      const title = String(pane.title ?? pane.id)

      stripTabToggles.set(
        pane.id,
        registry.register(
          paletteToggle({
            id: `strip-tab.${pane.id}`,
            label: translateNow('zones.toggleStripTab', title),
            icon: LayoutDashboard,
            keywords: [title.toLowerCase(), 'tab', 'pane', 'sidebar', 'show', 'hide'],
            // On-screen truth, same contract as the logs toggle above.
            get: () => isPaneVisible(pane.id),
            set: visible => {
              if (visible) {
                revealTreePane(pane.id)
              } else {
                setStripTabHidden(pane.id, true)
              }
            }
          })
        )
      )
    }
  }

  syncStripTabToggles()
  registry.subscribeArea('panes', syncStripTabToggles)
}

// YOLO (dangerous-command approval bypass) is a status-bar zap and a /yolo
// command; ⌘K is the third door onto the SAME store function, so a user who
// lives in the palette never has to hunt for the pill.
registry.register(
  paletteToggle({
    id: 'session.yolo',
    label: 'Toggle yolo',
    icon: Zap,
    keywords: ['yolo', 'approvals', 'auto-approve', 'bypass', 'dangerous', 'commands'],
    get: () => $yoloActive.get(),
    set: enabled => void setYoloEnabled(enabled).catch(() => undefined)
  })
)

// Sessions/files Close = collapse their SIDE (⌘B/⌘J truthful, titlebar button
// flips back) — but only while the pane actually lives in that root side
// column. Dragged next to main, a side collapse can't hide it (the collapse
// skips main-bearing children), so Close falls back to dismissal there —
// otherwise ⌘W/Close silently no-op.
registerPaneCloser('sessions', () =>
  paneRootSide('sessions') === 'left' ? setSidebarOpen(false) : dismissTreePane('sessions')
)
registerPaneCloser('files', () =>
  paneRootSide('files') === 'right' ? setFileBrowserOpen(false) : dismissTreePane('files')
)

// ---------------------------------------------------------------------------

interface TitlebarSlotProps {
  area: 'titleBar.center' | 'titleBar.left' | 'titleBar.right'
  className: string
}

function TitlebarSlot({ area, className }: TitlebarSlotProps) {
  const items = useContributions(area)

  if (items.length === 0) {
    return null
  }

  return (
    <div className={className} data-titlebar-slot={area}>
      <Slot area={area} />
    </div>
  )
}

export function ContribController() {
  useConnectionRegistry()
  const sidebarOpen = useStore($sidebarOpen)
  const location = useLocation()
  const view = appViewForPath(location.pathname)
  const settingsPage = view === 'settings'

  // HUD mode is the SAME app with its frame removed: the wiring (gateway,
  // sessions, streams, submit) mounts identically, and only the shell around
  // the chat surface differs. Branching here rather than at the window entry
  // is what keeps the HUD's composer the real composer.
  if (isHudWindow()) {
    return (
      <ContribWiring>
        <AppContextMenu />
        <HudShell />
      </ContribWiring>
    )
  }

  if (isBrowserWindow()) {
    return (
      <ContribWiring>
        <BrowserPopoutShell />
      </ContribWiring>
    )
  }

  return (
    <SidebarProvider
      className="h-screen min-h-0 flex-col bg-background"
      onOpenChange={setSidebarOpen}
      open={sidebarOpen}
      style={{ '--sidebar-width': '100%' } as CSSProperties}
    >
      <ContribWiring>
        <AppContextMenu />
        <div
          className="relative flex h-screen min-h-0 w-screen flex-col bg-(--ui-bg-chrome) text-(--ui-text-primary)"
          // Window-glass hook: this div and the sidebar-wrapper above it are
          // the app shell's two full-window opaque painters; the
          // [data-hermes-glass] rules in styles.css clear them so the tint
          // painted by <body> is the only thing between the page and the
          // vibrancy material.
          data-contrib-shell=""
          style={{ '--titlebar-height': '0px' } as CSSProperties}
        >
          {/* Slots share one bounded row between the native/tool clusters.
              Empty space remains draggable; each contribution owns its
              no-drag hit area. The workspace geometry aligns the title. */}
          <div
            className="relative flex shrink-0 items-center bg-(--ui-sidebar-surface-background) text-xs"
            data-slot="app-titlebar"
            style={{ height: `${TITLEBAR_HEIGHT}px` }}
          >
            {/* Drag strips, AppShell-style: cut to AVOID the fixed control
                clusters instead of overlapping them — Electron's no-drag
                carve-out of fixed/transformed elements is unreliable, so a
                full-bar drag base kills their clicks. In-flow slot content
                still carves via its own no-drag wrapper (the same pattern as
                the app's session-title button). */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-(--titlebar-controls-left,14px) [-webkit-app-region:drag]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-[calc(var(--titlebar-controls-left,14px)+var(--titlebar-controls-width,3rem)+0.75rem)] right-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,5.5rem)+0.75rem)] [-webkit-app-region:drag]"
            />
            <div
              className="pointer-events-none absolute inset-y-0 z-10 flex min-w-0 items-center justify-center gap-3 [&_[data-titlebar-slot]>*]:pointer-events-auto [&_[data-titlebar-slot]>*]:min-w-0 [&_[data-titlebar-slot]>*]:max-w-full [&_[data-titlebar-slot]>*]:[-webkit-app-region:no-drag]"
              data-titlebar-content=""
              style={{
                left: 'max(calc(var(--workspace-left, 0px) + 0.5rem), calc(var(--titlebar-controls-left, 14px) + var(--titlebar-controls-width, 3rem) + 1rem))',
                right:
                  'max(calc(var(--workspace-right, 0px) + 0.5rem), calc(var(--titlebar-tools-right, 0.75rem) + var(--titlebar-tools-width, 8.5rem) + 0.75rem))'
              }}
            >
              <TitlebarSlot area="titleBar.left" className="flex h-full min-w-0 items-center gap-2" />
              <TitlebarSlot area="titleBar.center" className="flex h-full min-w-0 w-full items-center gap-2" />
              <TitlebarSlot area="titleBar.right" className="flex h-full min-w-0 items-center justify-end gap-2" />
            </div>
          </div>

          {/* Keep the tiling tree mounted while Settings owns the foreground.
              Visibility preserves terminal/session lifecycles and restores the
              user's layout instantly when they return to chat. */}
          <div
            aria-hidden={settingsPage}
            className={
              settingsPage
                ? 'pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0'
                : 'relative flex min-h-0 min-w-0 flex-1'
            }
          >
            <WindowTitlebarContext.Provider value={view === 'chat' && !isAuxiliaryWindow()}>
              <SummaryWorkspace>
                <LayoutTreeRoot />
              </SummaryWorkspace>
            </WindowTitlebarContext.Provider>
          </div>

          {settingsPage && (
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              <WiredPane part="settings" />
            </div>
          )}

          {/* "Close running tab?" — the busy/input-blocked tile close gate. */}
          {!settingsPage && <SessionTileCloseConfirm />}
        </div>
      </ContribWiring>
    </SidebarProvider>
  )
}

// Referenced type kept for plugin authors' reference (payload shape of
// statusBar.* contributions).
export type { StatusbarItem }
