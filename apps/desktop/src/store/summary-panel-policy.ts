import { computed } from 'nanostores'

import { $workspaceIsPage } from '@/app/routes'
import { $narrowOverlayPaneIds } from '@/components/pane-shell/narrow-overlay-state'
import { allPaneIds, findGroupOfPane } from '@/components/pane-shell/tree/model'
import {
  $collapsedTreeSides,
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  $narrowViewport,
  paneRootSide
} from '@/components/pane-shell/tree/store'
import { isRestoredToolPanelGroup } from '@/components/pane-shell/tree/tool-panel-policy'
import { workspaceActivePane } from '@/components/pane-shell/tree/workspace-presentation'
import { $registryVersion, registry } from '@/contrib/registry'

import { $freshDraftKey } from './composer'
import { modeLayout } from './interface-mode'
import { $summaryOpen } from './summary'

/** Read the user's tool host; a management page only covers its saved presentation. */
export const $toolPanelVisible = computed(
  [
    $layoutTree,
    $collapsedTreeSides,
    $dismissedPanes,
    $hiddenTreePanes,
    $registryVersion,
    $narrowViewport,
    $narrowOverlayPaneIds
  ],
  (tree, collapsed, dismissed, hidden, _version, narrow, overlays) => {
    if (!tree) {
      return false
    }

    const panes = registry.getArea('panes')
    const paneFor = (id: string) => panes.find(pane => pane.id === id)

    return allPaneIds(tree).some(id => {
      const group = findGroupOfPane(tree, id)!

      if (!paneFor(id) || dismissed.has(id) || hidden.has(id) || !isRestoredToolPanelGroup(group, paneFor)) {
        return false
      }

      // Safe tools share workspace ownership. Explicit candidates preserve the
      // host's active tab while a route temporarily covers it with headerVeto.
      const available = group.panes.filter(paneId => paneFor(paneId) && !dismissed.has(paneId) && !hidden.has(paneId))
      const side = paneRootSide(id)

      return narrow
        ? overlays.has(id)
        : !group.minimized && workspaceActivePane(group, available) === id && !(side && collapsed.has(side))
    })
  }
)

/** Coordinate visibility without changing either pane's lifetime or saved layout. */
export function bindSummaryPanelVisibility(): () => void {
  let previous = $toolPanelVisible.get()
  let queued = false
  let active = true
  let quietBatch = false

  const settle = () => {
    // Restoration ends synchronously, before this batch's microtask runs.
    quietBatch ||= modeLayout.restoring || $workspaceIsPage.get()

    if (queued) {
      return
    }

    queued = true
    queueMicrotask(() => {
      queued = false

      if (!active) {
        return
      }

      const shown = $toolPanelVisible.get()

      if (shown !== previous && !quietBatch) {
        $summaryOpen.set(!shown)
      }

      previous = shown
      quietBatch = false
    })
  }

  const stopPanel = $toolPanelVisible.listen(settle)

  const stopDraft = $freshDraftKey.listen(() => {
    // Its former session's preview can leave later in this same turn.
    quietBatch = true
    $summaryOpen.set(false)
    settle()
  })

  return () => {
    active = false
    stopPanel()
    stopDraft()
  }
}
