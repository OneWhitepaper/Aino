import { useStore } from '@nanostores/react'

import { toggleToolPanelSide } from '@/app/right-sidebar/tool-panel-actions'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { $narrowOverlayPaneIds } from '@/components/pane-shell/narrow-overlay-state'
import { $narrowViewport } from '@/components/pane-shell/tree/store'
import { hostHas } from '@/lib/host-capabilities'
import { $leftSideOpen, $rightSideOpen, CHAT_SIDEBAR_PANE_ID, FILE_BROWSER_PANE_ID } from '@/store/layout'
import { REVIEW_PANE_ID } from '@/store/review'

/** Native edges follow docked columns; narrow browser edges follow the visible overlay. */
export function useTitlebarPanelEdges() {
  const rightSideOpen = useStore($rightSideOpen)
  const leftSideOpen = useStore($leftSideOpen)
  const narrowViewport = useStore($narrowViewport)
  const overlayPanes = useStore($narrowOverlayPaneIds)
  const browserHost = hostHas('narrowOverlayChrome')
  const overlayChrome = narrowViewport && browserHost
  const rightOverlayId = overlayPanes.has(REVIEW_PANE_ID) ? REVIEW_PANE_ID : FILE_BROWSER_PANE_ID

  const edge = (id: string, side: 'left' | 'right', dockedOpen: boolean) => {
    const open = overlayChrome ? overlayPanes.has(id) : dockedOpen

    return {
      open,
      expanded: browserHost ? open : undefined,
      toggle: overlayChrome
        ? () =>
            window.dispatchEvent(
              new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, {
                detail: { id, mode: open ? 'close' : 'open' }
              })
            )
        : () => toggleToolPanelSide(side)
    }
  }

  return {
    leftEdge: edge(CHAT_SIDEBAR_PANE_ID, 'left', leftSideOpen),
    rightEdge: edge(rightOverlayId, 'right', rightSideOpen)
  }
}
