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
 * temporarily retains only this existing track's geometry while it clears.
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
  const active = useRef<{ animation: Animation; release: () => void } | null>(null)
  const sizeKey = JSON.stringify(style)

  const cancel = useCallback(() => {
    const current = active.current
    active.current = null
    current?.release()
    current?.animation.cancel()
    ref.current?.removeAttribute('data-tool-track-motion')
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
      }
    },
    [enabled, horizontal]
  )

  useResizeObserver(rememberSize, ref)

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
    const sameScope = sameTrackScope(before, snapshot)

    // Unrelated renders leave an animation alone. A size edit during the
    // same open state is user resizing, so it must take over immediately.
    if (!edge) {
      if (!sameScope || !enabled || before?.sizeKey !== sizeKey) {
        cancel()
      }

      return
    }

    const current = active.current ? element.getBoundingClientRect() : null
    const from = current ? (horizontal ? current.width : current.height) : before.collapsed ? 0 : lastSize.current
    cancel()
    const natural = element.getBoundingClientRect()
    const to = collapsed ? 0 : horizontal ? natural.width : natural.height

    if (!canAnimateTrack(element, before, snapshot, from, to)) {
      if (to > 0) {
        lastSize.current = to
      }

      return
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    if (reduce.matches) {
      if (to > 0) {
        lastSize.current = to
      }

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

    const animation = element.animate([frame(from), frame(to)], {
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

    window.addEventListener('resize', cancel)
    document.addEventListener('pointerdown', onPointerDown, true)
    reduce.addEventListener('change', onReduce)

    const release = () => {
      window.removeEventListener('resize', cancel)
      document.removeEventListener('pointerdown', onPointerDown, true)
      reduce.removeEventListener('change', onReduce)
    }

    active.current = { animation, release }
    element.dataset.toolTrackMotion = to > from ? 'opening' : 'closing'
    void animation.finished.then(
      () => {
        if (active.current?.animation === animation) {
          cancel()

          if (to > 0) {
            lastSize.current = to
          }
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
