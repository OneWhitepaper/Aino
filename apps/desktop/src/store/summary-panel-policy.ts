import { computed } from 'nanostores'

import { $narrowOverlayPaneIds } from '@/components/pane-shell/narrow-overlay-state'
import { allPaneIds, findGroupOfPane } from '@/components/pane-shell/tree/model'
import {
  $collapsedTreeSides,
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  $narrowViewport,
  isPaneVisible
} from '@/components/pane-shell/tree/store'
import { isRestoredToolPanelGroup } from '@/components/pane-shell/tree/tool-panel-policy'
import { $registryVersion, registry } from '@/contrib/registry'

import { $freshDraftKey } from './composer'
import { modeLayout } from './interface-mode'
import { $summaryOpen } from './summary'

/** Read the actual tool host, including mirrored layouts and narrow overlays. */
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
  (tree, _collapsed, _dismissed, _hidden, _version, narrow, overlays) => {
    if (!tree) {
      return false
    }
    const panes = registry.getArea('panes')
    const paneFor = (id: string) => panes.find(pane => pane.id === id)

    return allPaneIds(tree).some(id => {
      const group = findGroupOfPane(tree, id)!

      return isRestoredToolPanelGroup(group, paneFor) && (narrow ? overlays.has(id) : isPaneVisible(id))
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
    quietBatch ||= modeLayout.restoring

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
