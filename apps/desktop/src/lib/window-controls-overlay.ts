/** Chromium reports this geometry in renderer CSS pixels, including page zoom. */
export interface WindowControlsOverlayLike {
  visible: boolean
  getTitlebarAreaRect: () => DOMRect
  addEventListener: (type: 'geometrychange', cb: () => void) => void
  removeEventListener: (type: 'geometrychange', cb: () => void) => void
}

export const windowControlsOverlay = () =>
  (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay ?? null

/** Null preserves the native fallback until the caption overlay has layout. */
export function measureWindowControlsOverlayWidth(wco: WindowControlsOverlayLike | null): number | null {
  const rect = wco?.visible ? wco.getTitlebarAreaRect() : null

  if (!rect?.width) {
    return null
  }

  const width = Math.round(window.innerWidth - rect.right)

  return width > 0 ? width : null
}
