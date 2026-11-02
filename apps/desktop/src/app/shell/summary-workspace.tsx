import './summary-workspace.css'

import { useStore } from '@nanostores/react'
import { motion } from 'motion/react'
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
  covered: boolean
}

function SummaryRail({ compact, reducedMotion, covered }: SummaryRailProps) {
  const expanded = { height: compact ? 'auto' : '100%', width: SUMMARY_RAIL_WIDTH }
  const collapsed = { ...expanded, width: 0 }
  const transition = { duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' as const }

  return (
    <motion.div
      animate={expanded}
      aria-hidden={covered || undefined}
      className={cn('flex min-h-0 min-w-0 shrink-0 items-start overflow-hidden', compact && 'pointer-events-none z-20')}
      data-layout={compact ? 'overlay' : 'docked'}
      data-slot="summary-rail"
      data-state="open"
      id="session-summary"
      inert={covered}
      initial={collapsed}
      style={{
        position: compact ? 'absolute' : undefined,
        top: compact ? 0 : undefined,
        right: compact ? 0 : undefined,
        bottom: compact ? 'max(0px, anchor(--summary-composer top, 0px))' : undefined,
        maxWidth: '100%',
        display: covered ? 'none' : undefined
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
        initial={{ opacity: 0, x: 16, y: 0 }}
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
      {open && ownsSummary && <SummaryRail compact={compact} covered={workspacePage} reducedMotion={reducedMotion} />}
    </div>
  )
}
