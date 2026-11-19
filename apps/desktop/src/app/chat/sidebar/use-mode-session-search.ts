import { useStore } from '@nanostores/react'
import { useCallback, useMemo, useState } from 'react'

import type { SessionInfo } from '@/hermes'
import { $cronSessions, $messagingSessions, $sessions } from '@/store/session'
import { $archivedSessions } from '@/store/sidebar-archive'

import { useSessionModeFilter } from './execution-mode-filter'
import { filterSessionsByProfileScope } from './profile-scope'
import { buildSessionByAnyId } from './session-index'
import { mergeSearchResults } from './session-search'
import { useServerSessionSearch } from './use-server-session-search'

/** Search resolves identities before filtering, so a hidden loaded Code row
 * cannot be synthesized as a legacy Work row from an older search payload. */
export function useModeSessionSearch(
  scope: string,
  sortedSessions: readonly SessionInfo[],
  onResumeSession: (sessionId: string, session?: SessionInfo) => void
) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const query = searchQuery.trim()
  const sessions = useStore($sessions)
  const cron = useStore($cronSessions)
  const messaging = useStore($messagingSessions)
  const archived = useStore($archivedSessions)
  const { matchesMode } = useSessionModeFilter()
  const { searchPending, serverMatches } = useServerSessionSearch(query, scope)

  const index = useMemo(
    () =>
      buildSessionByAnyId(
        filterSessionsByProfileScope([...sessions, ...archived], scope),
        filterSessionsByProfileScope(cron, scope),
        filterSessionsByProfileScope(messaging, scope)
      ),
    [sessions, cron, messaging, archived, scope]
  )

  const searchResults = useMemo(
    () => mergeSearchResults(sortedSessions, query, serverMatches, index, searchPending).filter(matchesMode),
    [sortedSessions, query, serverMatches, index, searchPending, matchesMode]
  )

  // Clear the dialog before navigating so reopening cannot paint old results.
  const onResumeSearchResult = useCallback(
    (sessionId: string, session?: SessionInfo) => {
      setSearchQuery('')
      setSearchOpen(false)
      onResumeSession(sessionId, session)
    },
    [onResumeSession]
  )

  return {
    searchQuery,
    setSearchQuery,
    searchOpen,
    setSearchOpen,
    searchPending,
    searchResults,
    onResumeSearchResult
  }
}
