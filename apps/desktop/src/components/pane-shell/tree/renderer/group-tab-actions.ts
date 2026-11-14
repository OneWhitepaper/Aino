import { revealSessionWorkspace } from '@/app/open-session'
import { openToolPanelChooser } from '@/app/right-sidebar/tool-panel-actions'
import type { Contribution } from '@/contrib/types'
import type { Translations } from '@/i18n'

import type { GroupNode } from '../model'
import { activateTreePane, closeTabPane, isCollapsePane, isSessionStripPane, restoreTreePane } from '../store'
import { clearTabSelection } from '../tab-selection'
import { isConversationPane } from '../workspace-presentation'

import { paneChrome } from './track-model'

/** Selecting a conversation mode leaves full pages; passive visibility never does. */
export function revealSidebarModeWorkspace(pane: Contribution | undefined): void {
  if (paneChrome(pane).sidebarMode) {
    revealSessionWorkspace(to => {
      window.location.hash = `#${to}`
    })
  }
}

interface GroupTabPolicyInput {
  node: GroupNode
  shown: readonly string[]
  paneFor: (id: string) => Contribution | undefined
  toolPanel: boolean
}

/** The active pane answers first, then a session tab, then any other tenant. */
export function groupNewTab({
  activeId,
  node,
  shown,
  paneFor,
  toolPanel,
  newSessionTabAction,
  t
}: GroupTabPolicyInput & { activeId: string; newSessionTabAction: null | (() => void); t: Translations }) {
  const ownNewTab = (id: string) => {
    const mint = paneChrome(paneFor(id)).newTab

    return mint ? { label: t.zones.newTab, onSelect: mint } : null
  }

  return (
    (toolPanel ? { label: t.zones.newTab, onSelect: () => openToolPanelChooser(node.id) } : null) ??
    ownNewTab(activeId) ??
    (shown.some(isSessionStripPane) && newSessionTabAction
      ? { label: t.zones.newSessionTab, onSelect: newSessionTabAction }
      : null) ??
    shown.map(ownNewTab).find(Boolean) ??
    null
  )
}

/** Every close/activate gesture shares the same pane lifecycle policy. */
export function groupTabActions({
  node,
  shown,
  paneFor,
  toolPanel,
  panesWithCloser
}: GroupTabPolicyInput & { panesWithCloser: ReadonlySet<string> }) {
  // Collapsing the uncloseable main workspace would strand the whole app.
  const minimizable = !node.panes.some(id => paneChrome(paneFor(id)).uncloseable)

  const isNavigationRail = shown.some(id => {
    const chrome = paneChrome(paneFor(id))

    return chrome.hideOnly && chrome.placement === 'left'
  })

  const showMinimizeButton = minimizable && !isNavigationRail && !toolPanel

  const activatePane = (paneId: string) => {
    clearTabSelection()
    revealSidebarModeWorkspace(paneFor(paneId))

    if (node.minimized || isCollapsePane(paneId)) {
      restoreTreePane(paneId)
    }

    activateTreePane(node.id, paneId)
  }

  // A store-owned close empties main to a draft. Standing navigation only hides.
  const closeableTab = (paneId: string) =>
    !paneChrome(paneFor(paneId)).hideOnly && (!paneChrome(paneFor(paneId)).uncloseable || panesWithCloser.has(paneId))

  return { activatePane, closeableTab, closeTab: closeTabPane, isNavigationRail, minimizable, showMinimizeButton }
}

interface SessionHeaderInput {
  workspacePage: boolean
  isEmpty: boolean
  verticalCollapse: boolean
  shown: readonly string[]
  headerVeto?: boolean
}

export function groupMinimizeLabel(t: Translations, toolPanel: boolean, active: Contribution | undefined): string {
  return toolPanel ? t.toolPanel.hide : paneChrome(active).lifecycleKeepAlive ? t.preview.hide : t.zones.minimize
}

/** Chat-only groups keep one title even when their ordinary tab strip is hidden. */
export function sessionHeaderVisible({
  workspacePage,
  isEmpty,
  verticalCollapse,
  shown,
  headerVeto
}: SessionHeaderInput): boolean {
  return (
    !workspacePage &&
    !isEmpty &&
    !verticalCollapse &&
    shown.length > 0 &&
    shown.every(isConversationPane) &&
    !headerVeto
  )
}
