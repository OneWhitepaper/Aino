import { useCallback } from 'react'

import type { SessionInfo } from '@/hermes'
import type { ProjectInfo } from '@/hermes'
import { normalizeProfileKey } from '@/store/profile'
import type { $projectOwnerBySessionId } from '@/store/projects'
import { pullRequestBucket, sessionPrKey } from '@/store/pull-requests'
import type { $pullRequestsByBranch, PullRequestBucket } from '@/store/pull-requests'
import { type $sessionDotStateById, sessionStatusBucket, type SessionStatusBucket } from '@/store/session-dot-state'

import { sessionMatchesProjectFilter } from './projects'

interface SessionFilters {
  matchesMode: (session: SessionInfo) => boolean
  statusFilter: readonly SessionStatusBucket[]
  projectFilter: readonly string[]
  profileFilter: readonly string[]
  showAllProfiles: boolean
  prFilter: readonly PullRequestBucket[]
  pullRequests: ReturnType<typeof $pullRequestsByBranch.get>
  projects: ProjectInfo[]
  projectOwners: ReturnType<typeof $projectOwnerBySessionId.get>
  dotStates: ReturnType<typeof $sessionDotStateById.get>
}

/** Shared by recents, pins and backend-populated project lanes. */
export function matchesSidebarSessionFilters(session: SessionInfo, filters: SessionFilters): boolean {
  const {
    matchesMode,
    statusFilter,
    projectFilter,
    profileFilter,
    showAllProfiles,
    prFilter,
    pullRequests,
    projects,
    projectOwners,
    dotStates
  } = filters

  if (
    !matchesMode(session) ||
    (statusFilter.length && !statusFilter.includes(sessionStatusBucket(dotStates[session.id])))
  ) {
    return false
  }

  if (showAllProfiles && profileFilter.length && !profileFilter.includes(normalizeProfileKey(session.profile))) {
    return false
  }

  if (prFilter.length) {
    const key = sessionPrKey(session)

    if (!prFilter.includes(pullRequestBucket(key ? pullRequests[key] : undefined))) {
      return false
    }
  }

  return sessionMatchesProjectFilter(session, projectFilter, projects, projectOwners)
}

export function useSidebarSessionFilters(filters: SessionFilters, modeFilter: 'current' | 'all') {
  const {
    matchesMode,
    statusFilter,
    projectFilter,
    profileFilter,
    showAllProfiles,
    prFilter,
    pullRequests,
    projects,
    projectOwners,
    dotStates
  } = filters

  const sessionMatchesFilters = useCallback(
    (session: SessionInfo) =>
      matchesSidebarSessionFilters(session, {
        matchesMode,
        statusFilter,
        projectFilter,
        profileFilter,
        showAllProfiles,
        prFilter,
        pullRequests,
        projects,
        projectOwners,
        dotStates
      }),
    [
      matchesMode,
      statusFilter,
      projectFilter,
      profileFilter,
      showAllProfiles,
      prFilter,
      pullRequests,
      projects,
      projectOwners,
      dotStates
    ]
  )

  const viewFiltersNarrow =
    statusFilter.length > 0 ||
    projectFilter.length > 0 ||
    prFilter.length > 0 ||
    (showAllProfiles && profileFilter.length > 0)

  return { sessionMatchesFilters, viewFiltersNarrow, filtersNarrow: modeFilter === 'current' || viewFiltersNarrow }
}
