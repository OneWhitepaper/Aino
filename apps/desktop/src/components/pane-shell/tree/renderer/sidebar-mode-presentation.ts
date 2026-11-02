import type { Contribution } from '@/contrib/types'

import { paneChrome } from './track-model'

/** Only the default navigation stack opts in. Unknown guests and edited or
 *  minimized layouts retain the ordinary draggable pane strip. */
export function sidebarModePanes(
  groupPanes: readonly string[],
  visiblePanes: readonly Contribution[],
  enabled: boolean
): readonly Contribution[] {
  return enabled &&
    groupPanes.includes('sessions') &&
    visiblePanes.length > 0 &&
    visiblePanes.every(pane => {
      const chrome = paneChrome(pane)

      return chrome.placement === 'left' && chrome.hideOnly && chrome.sidebarDescription
    })
    ? visiblePanes
    : []
}
