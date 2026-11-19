import { useStore } from '@nanostores/react'
import { useCallback, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { executionMode } from '@/lib/execution-mode'
import { $currentExecutionMode, $executionModeFilter, setExecutionModeFilter } from '@/store/execution-mode'
import { $cronSessions, $messagingSessions, $sessions } from '@/store/session'
import { $sessionDotStateById, sessionStatusBucket } from '@/store/session-dot-state'

import { filterSessionsByProfileScope } from './profile-scope'

export function useSessionModeFilter() {
  const mode = useStore($currentExecutionMode)
  const filter = useStore($executionModeFilter)

  const matchesMode = useCallback(
    (session: SessionInfo) => filter === 'all' || executionMode(session.execution_mode) === mode,
    [filter, mode]
  )

  return { matchesMode, modeFilter: filter }
}

/** Hidden work stays reachable without moving the foreground conversation. */
export function OtherModeActivity({ displayScope }: { displayScope: string }) {
  const { t } = useI18n()
  const { matchesMode } = useSessionModeFilter()
  const sessions = useStore($sessions)
  const cron = useStore($cronSessions)
  const messaging = useStore($messagingSessions)
  const dots = useStore($sessionDotStateById)

  const count = useMemo(
    () =>
      new Set(
        filterSessionsByProfileScope([...sessions, ...cron, ...messaging], displayScope)
          .filter(
            session =>
              !matchesMode(session) && ['working', 'needs-input'].includes(sessionStatusBucket(dots[session.id]))
          )
          .map(session => session._lineage_root_id || session.id)
      ).size,
    [sessions, cron, messaging, displayScope, matchesMode, dots]
  )

  return count > 0 ? (
    <Button
      className="mx-2 h-auto whitespace-normal text-left text-xs"
      onClick={() => setExecutionModeFilter('all')}
      variant="ghost"
    >
      <Codicon name="pulse" size="0.75rem" />
      {t.executionMode.otherModeActive} ({count})
    </Button>
  ) : null
}
