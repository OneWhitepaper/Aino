import { noteHoveredTreeGroup, restoreTreePane } from '@/components/pane-shell/tree/store'
import type { PreviewActAction, PreviewActResult, PreviewBrowserTabInfo } from '@/lib/preview-act/types'
import { $rightRailActiveTabId, selectRightRailTab } from '@/store/layout'
import { $browserPages, $poppedBrowserTabIds, previewTabsFor } from '@/store/preview'
import { noteExplicitPreviewOpen, PREVIEW_TILE_PREFIX } from '@/store/preview-explicit'
import type { PreviewOwner } from '@/store/preview-ownership'

import { activePreviewTabFor } from './preview-active-tab'
import { beginPreviewOperation } from './preview-agent-control'

function browserTabs(owner?: PreviewOwner): PreviewBrowserTabInfo[] {
  const selected = activePreviewTabFor(owner)?.id
  const pages = $browserPages.get()
  const popped = $poppedBrowserTabIds.get()

  return previewTabsFor(owner)
    .filter(tab => tab.target.kind === 'url')
    .map(tab => ({
      tab_id: tab.id,
      title: pages[tab.id]?.title || tab.target.label,
      url: pages[tab.id]?.url || tab.target.url,
      selected: tab.id === selected,
      popped_out: popped.has(tab.id)
    }))
}

/** Tab navigation changes selection only; the existing guest and its state stay alive. */
export async function runPreviewTabAction(
  action: Omit<PreviewActAction, 'kind'> & { kind: string },
  signal?: AbortSignal,
  owner?: PreviewOwner
): Promise<PreviewActResult> {
  signal?.throwIfAborted()
  const tabs = browserTabs(owner)

  if (action.kind === 'tabs') {
    return { success: true, tabs }
  }

  const tab = tabs.find(item => item.tab_id === action.tabId)
  const target = previewTabsFor(owner).find(item => item.id === action.tabId && item.target.kind === 'url')

  if (!tab || !target) {
    throw new Error('Choose an exact Browser tab_id from this conversation’s tabs list.')
  }

  const operation = beginPreviewOperation(tab.tab_id, 'acting')
  const currentSelection = $rightRailActiveTabId.get()

  try {
    if (tab.popped_out) {
      const open = window.hermesDesktop?.openBrowserWindow

      if (!open) {
        throw new Error('This Browser tab is in a separate desktop window. Ask the user to show it.')
      }

      const result = await open(tab.tab_id)

      if (!result.ok) {
        throw new Error(result.error || 'The Browser window could not be selected.')
      }
    }

    signal?.throwIfAborted()
    operation.signal.throwIfAborted()

    if (
      !browserTabs(owner).some(item => item.tab_id === tab.tab_id) ||
      $rightRailActiveTabId.get() !== currentSelection
    ) {
      throw new Error('The Browser tabs changed while selecting. List tabs again.')
    }

    // Selection is explicit model intent; stale hover from the old zone must
    // not silently redirect its next observation back to the old page.
    noteHoveredTreeGroup(null)
    noteExplicitPreviewOpen(target.id)

    if (!tab.popped_out) {
      restoreTreePane(`${PREVIEW_TILE_PREFIX}:${tab.tab_id}`)
    }

    selectRightRailTab(target.id)

    return {
      success: true,
      tab_id: tab.tab_id,
      title: tab.title,
      url: tab.url,
      tabs: browserTabs(owner),
      note: 'Browser tab selected without reloading. Observe again with elements or a screenshot before continuing.'
    }
  } finally {
    operation.release()
  }
}
