import { useEffect, useState } from 'react'

import { measureWindowControlsOverlayWidth, windowControlsOverlay } from '@/lib/window-controls-overlay'

// Measure the EXACT width of the native window-controls overlay (min/max/close)
// straight from the browser, instead of a hardcoded reservation.
//
// When Electron's Window Controls Overlay is active (native Windows AND WSLg),
// Chromium exposes `navigator.windowControlsOverlay`. Its getTitlebarAreaRect()
// returns the draggable title-bar rect that EXCLUDES the controls, so the
// controls' width on the right is `innerWidth - rect.right`. This is precise and
// self-correcting across DPI / host themes / window states — no magic numbers,
// and it sidesteps the WSLg-vs-Windows footprint guesswork.
//
// Returns null when WCO is unavailable (macOS, plain Linux, or before first
// layout), so callers fall back to the static reservation from the main process.

/**
 * Live width (px) of the right-side native window-controls overlay, or null when
 * the platform/build exposes no overlay (caller should use the static fallback).
 */
export function useWindowControlsOverlayWidth(): number | null {
  const [width, setWidth] = useState<number | null>(() => measureWindowControlsOverlayWidth(windowControlsOverlay()))

  useEffect(() => {
    const wco = windowControlsOverlay()

    if (!wco) {
      return
    }

    const update = () => setWidth(measureWindowControlsOverlayWidth(wco))

    // Re-measure on overlay geometry changes (maximize/restore, DPI) and on
    // window resize (innerWidth feeds the calc).
    wco.addEventListener('geometrychange', update)
    window.addEventListener('resize', update)
    update()

    return () => {
      wco.removeEventListener('geometrychange', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return width
}
