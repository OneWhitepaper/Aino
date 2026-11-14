import { setDimFallbackColor, useHasSelection, useSelection } from '@hermes/ink'
import { useCallback, useEffect, useRef } from 'react'

import { isMac } from '../lib/platform.js'

import { getInputSelection } from './inputSelectionStore.js'
import type { UiState } from './interfaces.js'

export function useTerminalSelection(colors: Pick<UiState['theme']['color'], 'muted' | 'selectionBg'>) {
  const hasSelection = useHasSelection()
  const selection = useSelection()
  const lastCopiedVersionRef = useRef(-1)

  useEffect(() => {
    selection.setSelectionBgColor(colors.selectionBg)
  }, [selection, colors.selectionBg])

  // Terminals that ignore SGR 2 (Apple_Terminal) get a literal color for
  // `dim` instead. Feed it the theme's muted tone so dimmed spans stay in
  // the palette — a hardcoded gray renders as a foreign foreground next to
  // themed text on the same line.
  useEffect(() => {
    setDimFallbackColor(colors.muted)
  }, [colors.muted])

  // macOS Terminal.app does not forward Cmd+C to fullscreen TUIs that enable
  // mouse tracking, so the only reliable native-feeling path is iTerm-style
  // copy-on-select: once a drag creates a stable TUI selection, write it to
  // the system clipboard while keeping the highlight visible.
  //
  // Subscribe directly via the ink selection bus (not useSyncExternalStore)
  // so React doesn't re-render MainApp on every drag-move tick. The version
  // ref de-dupes against re-entrant notifications.
  useEffect(() => {
    if (!isMac) {
      return
    }

    return selection.subscribe(() => {
      if (!selection.hasSelection()) {
        return
      }

      const state = selection.getState() as { isDragging?: boolean } | null

      if (state?.isDragging) {
        return
      }

      const version = selection.version()

      if (version === lastCopiedVersionRef.current) {
        return
      }

      lastCopiedVersionRef.current = version
      void selection.copySelectionNoClear()
    })
  }, [selection])

  const clearSelection = useCallback(() => {
    selection.clearSelection()
    getInputSelection()?.collapseToEnd()
  }, [selection])

  return { clearSelection, hasSelection, selection }
}
