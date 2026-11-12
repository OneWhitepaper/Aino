interface PlacementRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
}

interface CapsulePlacementInput {
  anchor: PlacementRect
  viewportWidth: number
  expanded: boolean
  titlebarBottom: number
  leftControls?: PlacementRect
  rightControls?: PlacementRect
}

/** A full-size desktop capsule yields to native controls only when space runs out. */
export function capsulePlacement(input: CapsulePlacementInput): { left: number; top: number } {
  const { anchor, viewportWidth, expanded, titlebarBottom, leftControls, rightControls } = input
  const width = Math.min(expanded ? 436 : anchor.width, viewportWidth - 20)
  const nativeLeft = leftControls ? leftControls.right + 8 : 10
  const nativeRight = rightControls ? rightControls.left - 8 : viewportWidth - 10
  const belowChrome = width > nativeRight - nativeLeft
  const minimum = belowChrome ? 10 : nativeLeft
  const maximum = belowChrome ? viewportWidth - 10 : nativeRight
  const center = anchor.left + anchor.width / 2

  return {
    left: Math.max(minimum + width / 2, Math.min(maximum - width / 2, center)),
    top: belowChrome ? Math.max(anchor.top, titlebarBottom + 8) : Math.max(0, anchor.top)
  }
}
