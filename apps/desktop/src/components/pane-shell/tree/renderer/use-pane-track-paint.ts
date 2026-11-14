import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'

interface TrackPlacement {
  anchor: string
  groupId: string
  overlay?: boolean
  track: HTMLElement | null
  slot: HTMLElement | null
  visible: boolean
}

interface TrackPaint {
  animation: Animation
  axis: 'width' | 'height'
  clip: Animation
  direction: 'opening' | 'closing'
  release: () => void
}

function trackMotion(track: HTMLElement) {
  const direction = track.dataset.toolTrackMotion

  if (direction !== 'opening' && direction !== 'closing') {
    return null
  }

  for (const animation of track.getAnimations?.() ?? []) {
    const effect = animation.effect as KeyframeEffect | null

    if (effect?.target !== track || animation.playState === 'idle' || animation.playState === 'finished') {
      continue
    }

    const frames = effect.getKeyframes()
    const end = frames.at(-1)
    const paintOnly = track.dataset.toolTrackTo !== undefined
    const axis = paintOnly || end?.width !== undefined ? 'width' : end?.height !== undefined ? 'height' : null
    const target = Number.parseFloat(paintOnly ? track.dataset.toolTrackTo! : String(axis && end?.[axis]))

    // Vertical body height excludes the zone header. Keep its existing exit
    // behavior; only horizontal opening can use the track target verbatim.
    if (!axis || (direction === 'opening' ? axis !== 'width' || !(target > 0) : target !== 0)) {
      continue
    }

    return { animation, axis, direction, effect, frames, target, paintOnly } as const
  }

  return null
}

function sameTrackPlacement(before: TrackPlacement | null, placement: TrackPlacement): boolean {
  return (
    !before ||
    (before.track === placement.track &&
      before.slot === placement.slot &&
      before.anchor === placement.anchor &&
      before.groupId === placement.groupId &&
      before.overlay === placement.overlay)
  )
}

function trackPaintState(before: TrackPlacement | null, placement: TrackPlacement, enabled: boolean) {
  const { track } = placement
  const motion = enabled && sameTrackPlacement(before, placement) && track ? trackMotion(track) : null
  const opening = placement.visible && motion?.direction === 'opening'
  const closing = !placement.visible && motion?.direction === 'closing' && track?.style.display === 'none'
  const edge = (opening && !before?.visible) || (closing && before?.visible)

  return { motion, opening, closing, edge }
}

function closingViewport(
  element: HTMLElement,
  placement: TrackPlacement,
  axis: 'width' | 'height',
  pin: { slot: HTMLElement; width: number } | null
): number {
  // The first opening can reverse before ResizeObserver records its kept size.
  if (axis === 'width' && pin?.slot === placement.slot) {
    return pin.width
  }

  return Number.parseFloat(element.style.getPropertyValue(`--pane-kept-${axis}`))
}

/** Keep native guest viewports steady while their track clips open or closed.
 * Logical visibility changes immediately; the guest never moves or remounts. */
export function usePaneTrackPaint(ref: RefObject<HTMLElement | null>, placement: TrackPlacement, enabled: boolean) {
  const previous = useRef<TrackPlacement | null>(null)
  const active = useRef<TrackPaint | null>(null)
  const stableWidth = useRef<{ slot: HTMLElement; width: number } | null>(null)
  const slotRef = useMemo(() => ({ current: placement.slot }), [placement.slot])

  const clear = useCallback(() => {
    const current = active.current
    active.current = null
    current?.release()
    current?.clip.cancel()
    const element = ref.current

    if (element) {
      element.style.removeProperty('visibility')
      element.removeAttribute('data-pane-exit-paint')
      element.removeAttribute('data-pane-track-paint')

      const pin = stableWidth.current
      const sameSlot = pin?.slot === previous.current?.slot

      if (current?.axis === 'height') {
        element.style[current.axis] = previous.current?.visible
          ? `anchor-size(${current.axis})`
          : `var(--pane-kept-${current.axis}, 0px)`
      } else if (current?.axis === 'width') {
        element.style.width = previous.current?.visible
          ? 'var(--pane-track-width, anchor-size(width))'
          : 'var(--pane-kept-width, 0px)'
      }

      if (pin && sameSlot) {
        element.style.setProperty('--pane-track-width', `${pin.width}px`)
      } else if (current?.axis === 'width') {
        element.style.removeProperty('--pane-track-width')
      }
    }
  }, [ref])

  const followSlotWidth = useCallback(
    (entries: readonly ResizeObserverEntry[]) => {
      const current = previous.current
      const pin = stableWidth.current
      const entry = entries.find(candidate => candidate.target === placement.slot)
      const width = entry?.contentRect.width

      if (
        !placement.visible ||
        !current?.visible ||
        !placement.slot?.isConnected ||
        current.slot !== placement.slot ||
        !pin ||
        pin.slot !== placement.slot ||
        !width ||
        width <= 0 ||
        (current.track && trackMotion(current.track)?.axis === 'width')
      ) {
        return
      }

      pin.width = width
      ref.current?.style.setProperty('--pane-track-width', `${width}px`)
    },
    [placement.slot, placement.visible, ref]
  )

  useResizeObserver(followSlotWidth, slotRef)

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = placement
    const element = ref.current

    const { track } = placement
    const pin = stableWidth.current

    if (pin && (!enabled || pin.slot !== placement.slot)) {
      stableWidth.current = null
      element?.style.removeProperty('--pane-track-width')
    }

    const { motion, opening, closing, edge } = trackPaintState(before, placement, enabled)
    const continuing = active.current?.animation === motion?.animation && (opening || closing)

    if (active.current && continuing) {
      return
    }

    clear()

    // A hidden cache must never be made visible just because its track moves.
    if (!element?.animate || !track || !motion || !edge) {
      return
    }

    const { animation, axis, direction, effect, frames, paintOnly } = motion

    const viewport = opening ? motion.target : closingViewport(element, placement, axis, pin)

    if (!(viewport > 0)) {
      return
    }

    // Electron briefly resizes the native guest to zero when a pixel width
    // hands back to anchor-size(), even if sampled DOM bounds never change.
    // Prepare it while closing too, before the next visibility commit can
    // expose the zero-width opening track. Its slot observer owns real resizes.
    if (axis === 'width' && placement.slot) {
      stableWidth.current = { slot: placement.slot, width: viewport }
    }

    if (axis === 'width') {
      element.style.setProperty('--pane-track-width', `${viewport}px`)

      if (closing) {
        element.style.width = `${viewport}px`
      }
    } else {
      element.style.height = `${viewport}px`
    }

    const clip = element.animate(
      frames.map((frame, index) => {
        const size = paintOnly
          ? Number(index === 0 ? track.dataset.toolTrackFrom : track.dataset.toolTrackTo)
          : Number.parseFloat(String(frame[axis]))

        const inset = Math.max(0, viewport - size)

        return {
          clipPath:
            axis === 'height'
              ? `inset(0 0 ${inset}px 0)`
              : track.dataset.toolTrackClipLeft === 'true'
                ? `inset(0 0 0 ${inset}px)`
                : `inset(0 ${inset}px 0 0)`
        }
      }),
      { ...effect.getTiming(), fill: 'both' }
    )

    if (animation.currentTime !== null) {
      clip.currentTime = animation.currentTime
    }

    const observer = new MutationObserver(() => {
      if (track.dataset.toolTrackMotion !== direction) {
        clear()
      }
    })

    observer.observe(track, { attributes: true, attributeFilter: ['data-tool-track-motion'] })
    active.current = { animation, axis, clip, direction, release: () => observer.disconnect() }
    element.dataset.paneTrackPaint = direction

    if (closing) {
      element.style.visibility = 'visible'
      element.dataset.paneExitPaint = ''
    }

    const settle = () => {
      if (active.current?.animation === animation) {
        clear()
      }
    }

    void animation.finished.then(settle, settle)
  })

  useLayoutEffect(() => clear, [clear])
}
