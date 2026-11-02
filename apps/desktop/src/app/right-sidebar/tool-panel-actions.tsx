import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { allPaneIds, findGroupOfPane, movePane } from '@/components/pane-shell/tree/model'
import { setTreePaneParked } from '@/components/pane-shell/tree/parked-panes'
import {
  $activePresetId,
  $collapsedTreeSides,
  $hiddenTreePanes,
  $layoutTree,
  dismissTreePane,
  paneRootSide,
  persistTree,
  registerPaneCloser,
  restoreTreePane,
  revealTreePane,
  rootRow
} from '@/components/pane-shell/tree/store'
import { consolidateRestoredToolPanels, isRestoredToolPanelGroup } from '@/components/pane-shell/tree/tool-panel-policy'
import { Codicon } from '@/components/ui/codicon'
import { registry } from '@/contrib/registry'
import { matchesQuery } from '@/hooks/use-media-query'
import { LocalizedTabTitle, translateNow } from '@/i18n'
import { readKey, writeKey } from '@/lib/storage'
import { modeLayout } from '@/store/interface-mode'
import { $fileBrowserOpen, toggleLeftSide, toggleRightSide } from '@/store/layout'
import { newBrowserTab } from '@/store/preview'
import { revealReview, reviewBelongsToCurrentDraft } from '@/store/review'
import { $toolSession } from '@/store/tool-session'
import { isAuxiliaryWindow } from '@/store/windows'

import { ToolPanelChooser } from './tool-panel-chooser'

export const TOOL_CHOOSER_PANE = 'tool-new-tab'

/** Generic panel intent restores usable tabs; dormant layout defaults open the chooser. */
export function toggleToolPanelSide(side: 'left' | 'right'): void {
  const fallback = side === 'left' ? toggleLeftSide : toggleRightSide
  const row = rootRow()
  const edge = side === 'left' ? row?.children[0] : row?.children.at(-1)
  const panes = registry.getArea('panes')
  const main = (id: string) => id === 'workspace' || id.startsWith('session-tile:') || id.startsWith('route-tile:')

  if (
    !row ||
    edge?.type !== 'group' ||
    !row.children.some(child => allPaneIds(child).some(main)) ||
    !isRestoredToolPanelGroup(edge, id => panes.find(pane => pane.id === id))
  ) {
    fallback()

    return
  }

  const shown = edge.panes.filter(id => !$hiddenTreePanes.get().has(id) && panes.some(pane => pane.id === id))
  const narrow = matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)
  const rootSide = paneRootSide(edge.panes[0])

  if (!narrow && !edge.minimized && !(rootSide && $collapsedTreeSides.get().has(rootSide)) && shown.length > 0) {
    fallback()

    return
  }

  const session = $toolSession.get()

  const usable = shown.filter(id => {
    if (id === 'files') {
      return Boolean(session.cwd) || $fileBrowserOpen.get()
    }

    if (id === 'review' && !session.storedId && !session.cwd) {
      return reviewBelongsToCurrentDraft()
    }

    return true
  })

  const pane = usable.includes(edge.active) ? edge.active : usable[0]

  if (!pane) {
    openToolPanelChooser(edge.id)
  } else if (narrow) {
    // The overlay already owns its open/closed state; a generic toggle must not
    // first force it open through a pane opener and then immediately close it.
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: pane, mode: 'toggle' } }))
  } else {
    restoreTreePane(pane)
  }
}

$layoutTree.subscribe(tree => {
  setTreePaneParked(TOOL_CHOOSER_PANE, !tree || !findGroupOfPane(tree, TOOL_CHOOSER_PANE))
})

/** Closing the Files tab must never invoke the whole-column visibility toggle. */
export function closeUnifiedFilesTab(): boolean {
  const tree = $layoutTree.get()
  const group = tree && findGroupOfPane(tree, 'files')
  const panes = registry.getArea('panes')

  if (!group || !isRestoredToolPanelGroup(group, id => panes.find(pane => pane.id === id))) {
    return false
  }

  dismissTreePane('files')

  return true
}

/** Upgrade every restored tool deck, including old custom layouts with the v1 marker. */
export function migrateToolPanelLayout(): void {
  if (isAuxiliaryWindow()) {
    return
  }

  const restored = $layoutTree.get()

  if (restored && findGroupOfPane(restored, TOOL_CHOOSER_PANE)) {
    ensureToolPanelChooser()
  }

  const key = `aino.desktop.toolPanel.v1.${modeLayout.mode}`
  const migrated = Boolean(readKey(key))
  const original = $layoutTree.get()

  if (!original) {
    return
  }

  const panes = registry.getArea('panes')
  const paneFor = (id: string) => panes.find(pane => pane.id === id)

  const tree = consolidateRestoredToolPanels(
    original,
    paneFor,
    ['focus', 'quad', 'terminal-deck'].includes($activePresetId.get())
  )

  if (tree !== original) {
    $layoutTree.set(tree)
    persistTree()
  }

  if (!migrated) {
    writeKey(key, '1')
  }
}

function ensureToolPanelChooser(): void {
  if (!registry.getArea('panes').some(pane => pane.id === TOOL_CHOOSER_PANE)) {
    registry.register({
      id: TOOL_CHOOSER_PANE,
      area: 'panes',
      title: translateNow('zones.newTab'),
      data: {
        placement: 'right',
        toolPanel: true,
        minWidth: '20rem',
        dock: { pane: 'files', pos: 'center' },
        newTab: openToolPanelChooser,
        tabLead: () => <Codicon name="add" size="0.875rem" />,
        tabTitle: () => <LocalizedTabTitle select={t => t.zones.newTab} />,
        tabTitleText: () => translateNow('zones.newTab')
      },
      render: () => <ToolPanelChooser />
    })
    registerPaneCloser(TOOL_CHOOSER_PANE, () => dismissTreePane(TOOL_CHOOSER_PANE))
  }
}

/** One chooser per tool group, represented by an ordinary pane in the authoritative tree. */
export function openToolPanelChooser(groupId?: string): void {
  ensureToolPanelChooser()
  setTreePaneParked(TOOL_CHOOSER_PANE, false)
  revealTreePane(TOOL_CHOOSER_PANE)
  const tree = $layoutTree.get()

  if (tree && groupId) {
    $layoutTree.set(movePane(tree, TOOL_CHOOSER_PANE, { groupId, pos: 'center' }))
    persistTree()
  }

  restoreTreePane(TOOL_CHOOSER_PANE)
}

export function openToolPanelResource(paneId: 'files' | 'review' | 'terminal' | 'browser'): void {
  if (paneId === 'browser') {
    newBrowserTab()
  } else if (paneId === 'review') {
    const session = $toolSession.get()
    revealReview(session.cwd || null, session.target)
  } else {
    restoreTreePane(paneId)
  }

  dismissTreePane(TOOL_CHOOSER_PANE)
}
