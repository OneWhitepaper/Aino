import './summary-workspace.css'

import { useStore } from '@nanostores/react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import {
  Component,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import type { ComposerTarget } from '@/app/chat/composer/focus'
import { WiredPane } from '@/app/contrib/context'
import { $workspaceIsPage } from '@/app/routes'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { CARD_SURFACE_CLASS } from '@/components/ui/card-surface'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $summaryOpen } from '@/store/summary'
import { $toolSession } from '@/store/tool-session'

import { BOT_SUMMARY_RAIL_WIDTH, SUMMARY_RAIL_WIDTH, useSummaryDock } from './use-summary-dock'

interface SummaryWorkspaceProps {
  children: ReactNode
  target?: ComposerTarget
}

interface SummaryRailProps {
  compact: boolean
  reducedMotion: boolean
  onTakeOver: () => void
  width: number
}

interface SummaryExitSnapshotProps {
  children: ReactNode
  present: boolean
  railRef: RefObject<HTMLDivElement | null>
  onExit: (bounds: DOMRect) => void
}

/** Only React's before-mutation snapshot can capture position-only moves and
 * the old rail before sibling tools commit their final flex geometry. */
class SummaryExitSnapshot extends Component<SummaryExitSnapshotProps, Record<string, never>, DOMRect | null> {
  getSnapshotBeforeUpdate(previous: SummaryExitSnapshotProps) {
    return previous.present && !this.props.present
      ? (this.props.railRef.current?.getBoundingClientRect() ?? null)
      : null
  }

  componentDidUpdate(
    _previous: SummaryExitSnapshotProps,
    _state: Readonly<Record<string, never>>,
    bounds: DOMRect | null
  ) {
    if (bounds) {
      this.props.onExit(bounds)
    }
  }

  render() {
    return this.props.children
  }
}

function summaryRailStyle(compact: boolean, present: boolean, width: number, bounds: DOMRect | null): CSSProperties {
  const outgoing = !present && bounds

  // Layout settles in this commit. The outgoing card retains its old
  // viewport bounds while tools take its space, without reflowing chat.
  return {
    position: outgoing ? 'fixed' : compact || !present ? 'absolute' : undefined,
    left: outgoing ? bounds.left : undefined,
    top: outgoing ? bounds.top : compact ? 0 : undefined,
    right: outgoing ? undefined : compact || !present ? 0 : undefined,
    bottom: !outgoing && compact ? 'max(0px, anchor(--summary-composer top, 0px))' : undefined,
    width: outgoing ? bounds.width : width,
    height: outgoing ? bounds.height : compact ? 'auto' : '100%',
    maxWidth: outgoing ? undefined : '100%'
  }
}

function SummaryRail({ compact, reducedMotion, onTakeOver, width }: SummaryRailProps) {
  const present = useIsPresent()
  const railRef = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (present) {
      return
    }

    const takeOver = (event: Event) => {
      if (event.type === 'resize' || (event.target instanceof Element && event.target.closest('[role="separator"]'))) {
        onTakeOver()
      }
    }

    window.addEventListener('resize', takeOver)
    window.document.addEventListener('pointerdown', takeOver, true)

    return () => {
      window.removeEventListener('resize', takeOver)
      window.document.removeEventListener('pointerdown', takeOver, true)
    }
  }, [present, onTakeOver])

  const transition = { duration: reducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] as const }
  const exitTransition = { ...transition, duration: reducedMotion ? 0 : 0.16 }

  return (
    <SummaryExitSnapshot onExit={setBounds} present={present} railRef={railRef}>
      <motion.div
        animate={{ clipPath: 'inset(0 0 0 0%)' }}
        aria-hidden={!present || undefined}
        className={cn(
          'flex min-h-0 min-w-0 shrink-0 items-start justify-end overflow-hidden',
          compact && 'pointer-events-none z-20'
        )}
        data-layout={compact ? 'overlay' : 'docked'}
        data-slot="summary-rail"
        data-state={present ? 'open' : 'closing'}
        exit={{ clipPath: 'inset(0 0 0 100%)', transition: exitTransition }}
        id="session-summary"
        inert={!present}
        initial={reducedMotion ? false : { clipPath: 'inset(0 0 0 100%)' }}
        ref={railRef}
        style={summaryRailStyle(compact, present, width, bounds)}
        transition={transition}
      >
        <div
          className={cn(
            CARD_SURFACE_CLASS,
            'pointer-events-auto m-3 max-h-[calc(100%_-_1.5rem)] min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain'
          )}
          data-slot="summary-card"
        >
          <WiredPane part="summary" />
        </div>
      </motion.div>
    </SummaryExitSnapshot>
  )
}

/** Summary belongs to the working chat, never to a sibling file or preview pane. */
export function SummaryWorkspace({ children, target = 'main' }: SummaryWorkspaceProps) {
  const [motionEpoch, setMotionEpoch] = useState(0)
  const cancelExit = useCallback(() => setMotionEpoch(value => value + 1), [])
  const open = useStore($summaryOpen)
  const workspacePage = useStore($workspaceIsPage)
  const visible = usePaneVisible()
  const owner = useStoreSelector($toolSession, session => session.target)
  const ownsSummary = visible && target === owner
  const botWorkspace = useStore($workspaceMode) === 'bots' && !workspacePage
  const width = botWorkspace ? BOT_SUMMARY_RAIL_WIDTH : SUMMARY_RAIL_WIDTH
  const { compact, workspaceRef } = useSummaryDock(width)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1" data-slot="summary-workspace" ref={workspaceRef}>
      <div className="relative flex min-h-0 min-w-0 flex-1" data-slot="summary-workspace-main">
        {children}
      </div>
      {ownsSummary && (
        <div
          aria-hidden={workspacePage || undefined}
          className="contents"
          inert={workspacePage}
          style={{ display: workspacePage ? 'none' : undefined }}
        >
          {reducedMotion ? (
            open && <SummaryRail compact={compact} onTakeOver={cancelExit} reducedMotion width={width} />
          ) : (
            <AnimatePresence initial={false} key={motionEpoch}>
              {open && (
                <SummaryRail
                  compact={compact}
                  key="summary"
                  onTakeOver={cancelExit}
                  reducedMotion={false}
                  width={width}
                />
              )}
            </AnimatePresence>
          )}
        </div>
      )}
    </div>
  )
}
