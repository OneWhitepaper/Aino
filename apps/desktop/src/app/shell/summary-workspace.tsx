import './summary-workspace.css'

import { useStore } from '@nanostores/react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import type { ReactNode } from 'react'

import type { ComposerTarget } from '@/app/chat/composer/focus'
import { WiredPane } from '@/app/contrib/context'
import { $workspaceIsPage } from '@/app/routes'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { CARD_SURFACE_CLASS } from '@/components/ui/card-surface'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $summaryOpen } from '@/store/summary'
import { $toolSession } from '@/store/tool-session'

import { SUMMARY_RAIL_WIDTH, useSummaryDock } from './use-summary-dock'

interface SummaryWorkspaceProps {
  children: ReactNode
  target?: ComposerTarget
}

interface SummaryRailProps {
  compact: boolean
  reducedMotion: boolean
}

function SummaryRail({ compact, reducedMotion }: SummaryRailProps) {
  const present = useIsPresent()
  const expanded = { height: compact ? 'auto' : '100%', width: SUMMARY_RAIL_WIDTH }
  const collapsed = { ...expanded, width: compact ? SUMMARY_RAIL_WIDTH : 0 }
  const transition = { duration: reducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] as const }
  const exitTransition = { ...transition, duration: reducedMotion ? 0 : 0.16 }

  return (
    <motion.div
      animate={expanded}
      aria-hidden={!present || undefined}
      className={cn(
        'flex min-h-0 min-w-0 shrink-0 items-start justify-end overflow-hidden',
        compact && 'pointer-events-none z-20'
      )}
      data-layout={compact ? 'overlay' : 'docked'}
      data-slot="summary-rail"
      data-state={present ? 'open' : 'closing'}
      exit={{ ...collapsed, transition: exitTransition }}
      id="session-summary"
      inert={!present}
      initial={reducedMotion ? false : collapsed}
      style={{
        position: compact ? 'absolute' : undefined,
        top: compact ? 0 : undefined,
        right: compact ? 0 : undefined,
        bottom: compact ? 'max(0px, anchor(--summary-composer top, 0px))' : undefined,
        maxWidth: '100%'
      }}
      transition={transition}
    >
      <motion.div
        animate={{ opacity: 1, x: 0, y: 0 }}
        className={cn(
          CARD_SURFACE_CLASS,
          'pointer-events-auto m-3 max-h-[calc(100%_-_1.5rem)] min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain'
        )}
        data-slot="summary-card"
        exit={{ opacity: 0, x: reducedMotion ? 0 : 8, transition: exitTransition }}
        initial={reducedMotion ? false : { opacity: 0, x: 12, y: 0 }}
        transition={transition}
      >
        <WiredPane part="summary" />
      </motion.div>
    </motion.div>
  )
}

/** Summary belongs to the working chat, never to a sibling file or preview pane. */
export function SummaryWorkspace({ children, target = 'main' }: SummaryWorkspaceProps) {
  const open = useStore($summaryOpen)
  const workspacePage = useStore($workspaceIsPage)
  const visible = usePaneVisible()
  const owner = useStoreSelector($toolSession, session => session.target)
  const ownsSummary = visible && target === owner
  const { compact, workspaceRef } = useSummaryDock()
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
            open && <SummaryRail compact={compact} reducedMotion />
          ) : (
            <AnimatePresence initial={false}>
              {open && <SummaryRail compact={compact} key="summary" reducedMotion={false} />}
            </AnimatePresence>
          )}
        </div>
      )}
    </div>
  )
}
