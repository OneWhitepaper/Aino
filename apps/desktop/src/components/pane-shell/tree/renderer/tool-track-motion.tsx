import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useRef } from 'react'

import { useResizeObserver } from '@/hooks/use-resize-observer'

import { hiddenPaneProps } from '../../pane-visibility'

interface ToolTrackMotionProps {
  children: ReactNode
  collapsed: boolean
  enabled: boolean
  horizontal: boolean
  id: string
  minimized: boolean
  scope: string
  style: CSSProperties
}

interface TrackSnapshot {
  collapsed: boolean
  enabled: boolean
  horizontal: boolean
  minimized: boolean
  scope: string
  sizeKey: string
}

interface TrackAnimation {
  animation: Animation
  from: number
  to: number
  release: () => void
}

function visibleSize(current: TrackAnimation): number {
  const progress = current.animation.effect?.getComputedTiming().progress ?? 0

  return current.from + (current.to - current.from) * progress
}

function startSize(
  element: HTMLElement,
  current: TrackAnimation | null,
  horizontal: boolean,
  paintOnly: boolean,
  before: TrackSnapshot,
  lastSize: number
): number {
  if (!current) {
    return before.collapsed ? 0 : lastSize
  }

  if (paintOnly) {
    return visibleSize(current)
  }

  const rect = element.getBoundingClientRect()

  return horizontal ? rect.width : rect.height
}

function horizontalPaintFrames(
  from: number,
  to: number,
  rect: DOMRect,
  exiting: boolean,
  clipLeft: boolean
): Keyframe[] {
  const viewport = rect.width

  const bounds: Keyframe = exiting
    ? {
        display: 'flex',
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${viewport}px`,
        height: `${rect.height}px`,
        minWidth: '0px',
        maxWidth: 'none',
        minHeight: '0px',
        maxHeight: 'none'
      }
    : {}

  return [from, to].map(size => {
    const inset = Math.max(0, viewport - size)

    return {
      ...bounds,
      overflow: 'hidden',
      clipPath: clipLeft ? `inset(0 0 0 ${inset}px)` : `inset(0 ${inset}px 0 0)`
    }
  })
}

function sameTrackScope(before: TrackSnapshot | null, snapshot: TrackSnapshot): boolean {
  return before?.scope === snapshot.scope && before.horizontal === snapshot.horizontal
}

function canAnimateTrack(
  element: HTMLElement,
  before: TrackSnapshot,
  snapshot: TrackSnapshot,
  from: number,
  to: number
): boolean {
  return (
    snapshot.enabled &&
    before.enabled &&
    sameTrackScope(before, snapshot) &&
    document.visibilityState === 'visible' &&
    !document.body.classList.contains('guest-pointer-lock') &&
    typeof element.animate === 'function' &&
    !(Math.abs(from - to) < 1)
  )
}

/** Animate only explicit tool visibility edges, never sash-driven resizing.
 * The authoritative layout and guest visibility settle immediately; WAAPI
 * crops the existing horizontal track without rewrapping chat every frame.
 * Native guest hosts stay connected in their original keep-alive layer. */
export function ToolTrackMotion({
  children,
  collapsed,
  enabled,
  horizontal,
  id,
  minimized,
  scope,
  style
}: ToolTrackMotionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef<TrackSnapshot | null>(null)
  const lastSize = useRef(0)
  const lastRect = useRef<DOMRect | null>(null)
  const active = useRef<TrackAnimation | null>(null)
  const sizeKey = JSON.stringify(style)

  const cancel = useCallback(() => {
    const current = active.current
    active.current = null
    current?.release()
    current?.animation.cancel()
    ref.current?.removeAttribute('data-tool-track-motion')
    ref.current?.removeAttribute('data-tool-track-from')
    ref.current?.removeAttribute('data-tool-track-to')
    ref.current?.removeAttribute('data-tool-track-clip-left')
  }, [])

  const rememberSize = useCallback(
    (entries: readonly ResizeObserverEntry[]) => {
      if (!enabled || active.current) {
        return
      }

      const rect = entries[0]?.contentRect ?? ref.current?.getBoundingClientRect()
      const size = horizontal ? rect?.width : rect?.height

      if (size && size > 0) {
        lastSize.current = size
        lastRect.current = ref.current?.getBoundingClientRect() ?? null
      }
    },
    [enabled, horizontal]
  )

  useResizeObserver(rememberSize, ref)

  const rememberNatural = (size: number, rect: DOMRect) => {
    if (size > 0) {
      lastSize.current = size
      lastRect.current = rect
    }
  }

  const updateStableTrack = (element: HTMLElement, before: TrackSnapshot | null, snapshot: TrackSnapshot) => {
    const sameScope = sameTrackScope(before, snapshot)
    const changed = before?.sizeKey !== snapshot.sizeKey

    if (!sameScope || !enabled || changed) {
      cancel()
    }

    if (enabled && !collapsed && !active.current && (!before || !sameScope || changed)) {
      lastRect.current = element.getBoundingClientRect()
    }
  }

  useLayoutEffect(() => {
    const focused = ref.current?.ownerDocument.activeElement

    // Native inert excludes the track from navigation and the accessibility
    // tree, but its focused header may otherwise retain keyboard ownership.
    if (collapsed && focused instanceof HTMLElement && ref.current?.contains(focused)) {
      focused.blur()
    }
  }, [collapsed])

  useLayoutEffect(() => {
    const element = ref.current
    const before = previous.current
    const snapshot = { collapsed, enabled, horizontal, minimized, scope, sizeKey }
    previous.current = snapshot

    if (!element) {
      return
    }

    const edge = before && (before.collapsed !== collapsed || before.minimized !== minimized)

    // Unrelated renders leave an animation alone. A size edit during the
    // same open state is user resizing, so it must take over immediately.
    if (!edge) {
      updateStableTrack(element, before, snapshot)

      return
    }

    const paintOnly = horizontal && !before.minimized && !minimized
    const from = startSize(element, active.current, horizontal, paintOnly, before, lastSize.current)

    cancel()
    const natural = element.getBoundingClientRect()
    const to = collapsed ? 0 : horizontal ? natural.width : natural.height

    if (!canAnimateTrack(element, before, snapshot, from, to)) {
      rememberNatural(to, natural)

      return
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    if (reduce.matches) {
      rememberNatural(to, natural)

      return
    }

    const frame = (size: number): Keyframe => ({
      display: 'flex',
      flexBasis: `${size}px`,
      flexGrow: '0',
      flexShrink: '0',
      overflow: 'hidden',
      ...(horizontal
        ? { width: `${size}px`, minWidth: '0px', maxWidth: 'none' }
        : { height: `${size}px`, minHeight: '0px', maxHeight: 'none' })
    })

    // The final flex layout is already committed. Only the outgoing paint
    // stays above it on close; its constant bounds never resize the transcript.
    const paintRect = collapsed ? lastRect.current : natural
    const clipLeft = !!paintRect && paintRect.left + paintRect.width / 2 > window.innerWidth / 2

    rememberNatural(to, natural)

    const frames =
      paintOnly && paintRect
        ? horizontalPaintFrames(from, to, paintRect, collapsed, clipLeft)
        : [frame(from), frame(to)]

    const animation = element.animate(frames, {
      duration: to > from ? 220 : 160,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both'
    })

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[role="separator"]')) {
        cancel()
      }
    }

    const onReduce = () => {
      if (reduce.matches) {
        cancel()
      }
    }

    const onResize = () => {
      cancel()

      if (!collapsed) {
        lastRect.current = element.getBoundingClientRect()
      }
    }

    window.addEventListener('resize', onResize)
    document.addEventListener('pointerdown', onPointerDown, true)
    reduce.addEventListener('change', onReduce)

    const release = () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('pointerdown', onPointerDown, true)
      reduce.removeEventListener('change', onReduce)
    }

    active.current = { animation, from, to, release }
    element.dataset.toolTrackMotion = to > from ? 'opening' : 'closing'

    if (paintOnly && paintRect) {
      element.dataset.toolTrackFrom = String(from)
      element.dataset.toolTrackTo = String(to)
      element.dataset.toolTrackClipLeft = String(clipLeft)
    }

    void animation.finished.then(
      () => {
        if (active.current?.animation === animation) {
          cancel()

          rememberNatural(to, natural)
        }
      },
      () => undefined
    )
  })

  useLayoutEffect(() => cancel, [cancel])

  return (
    <div
      {...hiddenPaneProps(collapsed)}
      className="relative flex min-h-0 min-w-0"
      data-tree-track={id}
      inert={collapsed || undefined}
      ref={ref}
      style={style}
    >
      {children}
    </div>
  )
}
