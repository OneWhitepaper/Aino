import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'

export const SUMMARY_RAIL_WIDTH = 344
export const BOT_SUMMARY_RAIL_WIDTH = 320

/** Keep a readable chat beside the card; sibling tools do not own this layout. */
export function useSummaryDock(railWidth = SUMMARY_RAIL_WIDTH) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)

  const measure = useCallback(() => {
    const workspace = workspaceRef.current

    if (!workspace) {
      return
    }

    const width = workspace.getBoundingClientRect().width
    setCompact(width < 640 + railWidth)
  }, [railWidth])

  useResizeObserver(measure, workspaceRef)

  useLayoutEffect(measure, [measure])

  return { compact, workspaceRef }
}
