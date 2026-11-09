import type { Contribution } from '@/contrib/types'
import type { TabStripDefault } from '@/store/tabstrip-prefs'

import type { GroupNode } from '../model'
import { isCollapsePane } from '../store'

import { sessionHeaderVisible } from './group-tab-actions'
import { tabStripVisibleForZone } from './strip-visibility'
import type { paneChrome } from './track-model'

interface GroupHeaderPresentationOptions {
  node: GroupNode
  shown: string[]
  paneFor: (id: string) => Contribution | undefined
  activeId: string
  activeChrome: ReturnType<typeof paneChrome>
  tabStripDefault: TabStripDefault
  toolPanel: boolean
  workspacePage: boolean
  parentAxis?: 'column' | 'row'
  isEmpty: boolean
  compactSidebar: boolean
  pageHeader: unknown
  compactTabs: boolean
  editMode: boolean
  hasWindowTitlebar: boolean
}

function groupStripVisible({
  toolPanel,
  workspacePage,
  shown,
  activeId,
  tabStripDefault,
  node,
  paneFor
}: Pick<
  GroupHeaderPresentationOptions,
  'toolPanel' | 'workspacePage' | 'shown' | 'activeId' | 'tabStripDefault' | 'node' | 'paneFor'
>): boolean {
  // ONE header style: the app's compact pane-header. Whether this zone shows
  // it is the resolver's call, not this component's — see strip-visibility.ts
  // for the precedence. The same resolver answers for the toggle command, so
  // the keystroke and the screen always agree about which way "toggle" points.
  const stripVisible =
    toolPanel ||
    (!(workspacePage && shown.includes('workspace')) &&
      tabStripVisibleForZone({
        active: activeId,
        defaultMode: tabStripDefault,
        isCollapsePane,
        mode: node.tabStrip,
        paneFor,
        shown
      }))

  return stripVisible
}

export function groupHeaderPresentation({
  node,
  shown,
  paneFor,
  activeId,
  activeChrome,
  tabStripDefault,
  toolPanel,
  workspacePage,
  parentAxis,
  isEmpty,
  compactSidebar,
  pageHeader,
  compactTabs,
  editMode,
  hasWindowTitlebar
}: GroupHeaderPresentationOptions) {
  const stripVisible = groupStripVisible({ toolPanel, workspacePage, shown, activeId, tabStripDefault, node, paneFor })

  // A group collapses ALONG its parent split's axis. In a row that means the
  // WIDTH collapses — a full-width horizontal header would strand a tall
  // empty column, so the minimized form is a narrow vertical rail instead
  // (tabs reading top-to-bottom). In a column (stacked zones) the horizontal
  // header IS the collapsed form, exactly as before.
  //
  // Non-tool minimized row groups keep their vertical restore rail. Unified
  // tools hide their whole track instead of leaving the old 28px strip.
  const verticalCollapse = !toolPanel && Boolean(node.minimized) && parentAxis === 'row' && !isEmpty

  // A minimized group IS its header, so it shows one regardless.
  const headerVisible =
    !compactSidebar &&
    !isEmpty &&
    !verticalCollapse &&
    (Boolean(node.minimized) || stripVisible || Boolean(pageHeader) || compactTabs)

  // Chat sessions are navigated from the Sessions rail, so a row of session
  // tabs in the main header is redundant.  Keep the layout tree (and its
  // active pane) intact, but present one Codex-style title for the pane being
  // viewed — including the primary workspace, whose contribution title tracks
  // the routed session (syncWorkspaceTitle), so a routed conversation gets the
  // same single heading as a tile.  The zone's in-surface ChatHeader stays
  // display:none inside trees (renderer/index.tsx), so this header is the only
  // title a chat zone paints.  Layout edit mode deliberately keeps the full
  // tab strip so every pane remains draggable/reorderable while editing.
  // Independent of stripVisible: a workspace-only chat zone (no tiles open —
  // the default main zone) auto-hides its strip, and that must not take the
  // single session title with it.
  const hideSessionTabStrip =
    !compactTabs &&
    sessionHeaderVisible({
      workspacePage,
      isEmpty,
      verticalCollapse,
      editMode,
      shown,
      headerVeto: activeChrome.headerVeto
    })

  const singleSessionHeader = hideSessionTabStrip
  // Workspace ownership survives conversation scoping: bots and groups hide
  // the ordinary workspace tab, but still occupy its primary window zone.
  const titleInWindowBar = hasWindowTitlebar && singleSessionHeader && node.panes.includes('workspace') && !node.minimized

  return { stripVisible, verticalCollapse, headerVisible, hideSessionTabStrip, singleSessionHeader, titleInWindowBar }
}
