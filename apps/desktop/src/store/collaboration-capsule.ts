import { computed } from 'nanostores'

import { translateNow } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import type { SessionInfo } from '@/types/hermes'

import { $botChatScopes } from './bot-chat-scope'
import {
  type CollaborationGroup,
  collaborationGroupsFor,
  collaborationOwnerKey,
  type CollaborationRoomBinding,
  collaborationRoomKey,
  type CollaborationSource,
  type CollaborationTask
} from './collaboration-capsule-model'
import { $liveWorkRoster, type LiveWorkRoster } from './live-work-roster'
import {
  $activeSessionId,
  $cronSessions,
  $messagingSessions,
  $selectedStoredSessionId,
  $sessions,
  $unlistedSessionOwnerRows,
  ownerLookupSessionRows,
  sessionMatchesStoredId
} from './session'
import { isSessionOwnerRoute, requestForSessionProfile, type SessionOwnerScope } from './session-request-router'
import {
  $sessionStates,
  $sessionTiles,
  knownOwnerForSession,
  type SessionTileWorkspaceScope,
  storedSessionIdForRuntimeId
} from './session-states'
import { $subagentsBySession, type SubagentProgress, subagentsWithHistory } from './subagents'

export type {
  CollaborationGroup,
  CollaborationRoomBinding,
  CollaborationSource,
  CollaborationTask
} from './collaboration-capsule-model'
export { collaborationGroupsFor, collaborationOwnerKey, collaborationRoomKey } from './collaboration-capsule-model'

function sourceScopeMatches(scope: SessionTileWorkspaceScope | undefined, owner: SessionOwnerScope): boolean {
  if (!scope) {
    return false
  }

  const scopeOwner = scope.ownerRoute ?? scope.ownerProfile

  return !scopeOwner || collaborationOwnerKey(scopeOwner) === collaborationOwnerKey(owner)
}

function sourceRowMatches(row: SessionInfo, storedId: string, owner: SessionOwnerScope): boolean {
  if (!sessionMatchesStoredId(row, storedId)) {
    return false
  }

  const profile = typeof owner === 'string' ? owner : owner?.profile
  const target = typeof owner === 'object' && owner ? owner.targetProfile : profile
  const matchesProfile = Boolean(profile && [profile, target].includes(row.profile || 'default'))

  return row.connection_id
    ? Boolean(typeof owner === 'object' && owner?.connectionId === row.connection_id && matchesProfile)
    : matchesProfile
}

function rosterScopeFor(storedId: string | null, owner: SessionOwnerScope): SessionTileWorkspaceScope | undefined {
  if (!storedId || !collaborationOwnerKey(owner)) {
    return undefined
  }

  return Object.values($liveWorkRoster.get())
    .filter(bucket => collaborationOwnerKey(bucket.owner) === collaborationOwnerKey(owner))
    .map(bucket => bucket.sourceScopesBySession?.[storedId])
    .find(scope => scope?.ownerRoute && sourceScopeMatches(scope, owner))
}

function roomBindingFor(storedId: string | null, owner: SessionOwnerScope): CollaborationRoomBinding | undefined {
  if (!storedId || !isSessionOwnerRoute(owner)) {
    return undefined
  }

  const source = Object.values($liveWorkRoster.get())
    .filter(bucket => collaborationOwnerKey(bucket.owner) === collaborationOwnerKey(owner))
    .map(bucket => bucket.sourcesBySession?.[storedId])
    .find(source => source?.kind === 'bot_room')

  if (!source) {
    return undefined
  }

  const binding = {
    connectionId: owner.connectionId,
    profile: source.profile,
    roomId: source.room_id,
    roomName: source.room_name
  }

  return collaborationRoomKey(binding) ? binding : undefined
}

function collaborationSourceFor(
  parentRuntimeId: string,
  rows: SessionInfo[],
  storedSessionId = storedSessionIdForRuntimeId(parentRuntimeId),
  owner = knownOwnerForSession(parentRuntimeId, rows),
  discovered = rosterScopeFor(storedSessionId, owner)
): CollaborationSource {
  const tile = $sessionTiles
    .get()
    .find(candidate =>
      parentRuntimeId
        ? candidate.runtimeId === parentRuntimeId
        : candidate.storedSessionId === storedSessionId &&
          sourceScopeMatches(candidate as SessionTileWorkspaceScope, owner)
    )

  const remembered = storedSessionId ? $botChatScopes.get()[storedSessionId] : undefined

  const provenDiscovery = discovered?.ownerRoute && sourceScopeMatches(discovered, owner) ? discovered : undefined

  const scopes = [tile as SessionTileWorkspaceScope | undefined, remembered, provenDiscovery].filter(
    (scope): scope is SessionTileWorkspaceScope => Boolean(scope && sourceScopeMatches(scope, owner))
  )

  const scope = scopes.find(candidate => candidate.workspaceMode === 'bots') ?? scopes[0]

  const row = storedSessionId ? rows.find(candidate => sourceRowMatches(candidate, storedSessionId, owner)) : undefined

  return {
    parentRuntimeId,
    storedSessionId,
    owner,
    title:
      scope?.workspaceTabTitle?.trim() || (row ? sessionTitle(row) : translateNow('sidebar.row.untitledPlaceholder')),
    workspaceMode: scope?.workspaceMode ?? 'sessions',
    workspaceOwnerKey: scope?.workspaceOwnerKey,
    roomBinding: roomBindingFor(storedSessionId, owner)
  }
}

function observedTasksFor(
  source: CollaborationSource,
  items: readonly SubagentProgress[],
  roster: LiveWorkRoster
): readonly SubagentProgress[] {
  const ownerKey = collaborationOwnerKey(source.owner)

  if (!ownerKey || !source.storedSessionId) {
    return items
  }

  const storedId = source.storedSessionId
  const buckets = Object.values(roster).filter(bucket => collaborationOwnerKey(bucket.owner) === ownerKey)

  return items.filter(item => {
    if (item.status !== 'running' && item.status !== 'queued') {
      return true
    }

    return !buckets.some(bucket => {
      if (bucket.at <= item.updatedAt) {
        return false
      }

      const counts = bucket.sessions[storedId]
      const covers = bucket.covers.has(storedId) || Boolean(counts)
      const workers = bucket.workersBySession?.[storedId]

      return (
        covers && ((counts?.subagents ?? 0) === 0 || Boolean(workers && !workers.some(worker => worker.id === item.id)))
      )
    })
  })
}

function runtimeForRosterSource(
  storedId: string,
  owner: SessionOwnerScope,
  sources: readonly CollaborationSource[]
): string {
  const ownerKey = collaborationOwnerKey(owner)

  if (!ownerKey) {
    return ''
  }

  const observed = sources.find(
    source => source.storedSessionId === storedId && collaborationOwnerKey(source.owner) === ownerKey
  )

  if (observed) {
    return observed.parentRuntimeId
  }

  const runtimes = [
    ...$sessionTiles
      .get()
      .filter(tile => tile.storedSessionId === storedId)
      .map(tile => tile.runtimeId),
    ...Object.entries($sessionStates.get())
      .filter(([, state]) => state.storedSessionId === storedId)
      .map(([id]) => id)
  ]

  return runtimes.find(runtime => runtime && collaborationOwnerKey(knownOwnerForSession(runtime)) === ownerKey) ?? ''
}

let previousGroups: CollaborationGroup[] = []

function stableGroups(next: CollaborationGroup[]): CollaborationGroup[] {
  const stable = next.map(group => {
    const previous = previousGroups.find(item => item.key === group.key)

    if (
      !previous ||
      previous.title !== group.title ||
      previous.workspaceMode !== group.workspaceMode ||
      previous.workspaceOwnerKey !== group.workspaceOwnerKey ||
      previous.roomBinding?.roomName !== group.roomBinding?.roomName ||
      collaborationRoomKey(previous.roomBinding) !== collaborationRoomKey(group.roomBinding) ||
      previous.tasks.length !== group.tasks.length ||
      previous.runtimeIds.length !== group.runtimeIds.length ||
      previous.runtimeIds.some((id, index) => id !== group.runtimeIds[index])
    ) {
      return group
    }

    const unchanged = group.tasks.every((task, index) => {
      const old = previous.tasks[index]!

      return Object.entries(task).every(([key, value]) =>
        key === 'owner'
          ? collaborationOwnerKey(task.owner) === collaborationOwnerKey(old.owner)
          : value === old[key as keyof CollaborationTask]
      )
    })

    return unchanged ? previous : group
  })

  if (stable.length !== previousGroups.length || stable.some((group, index) => group !== previousGroups[index])) {
    previousGroups = stable
  }

  return previousGroups
}

/** One view of existing delegation facts; observing this store never opens a session. */
export const $collaborationGroups = computed(
  [
    $subagentsBySession,
    $sessionStates,
    $sessionTiles,
    $sessions,
    $cronSessions,
    $messagingSessions,
    $unlistedSessionOwnerRows,
    $botChatScopes,
    $activeSessionId,
    $selectedStoredSessionId,
    $liveWorkRoster
  ],
  subagents => {
    const rows = ownerLookupSessionRows()
    const sources = Object.keys(subagents).map(runtimeId => collaborationSourceFor(runtimeId, rows))
    const roster = $liveWorkRoster.get()

    const history = Object.fromEntries(
      sources.map(source => [
        source.parentRuntimeId,
        observedTasksFor(source, subagentsWithHistory(subagents[source.parentRuntimeId] ?? []), roster)
      ])
    )

    for (const bucket of Object.values(roster)) {
      // A worker count from an older source is not an ownership claim.
      if (!collaborationOwnerKey(bucket.owner)) {
        continue
      }

      for (const [storedId, workers] of Object.entries(bucket.workersBySession ?? {})) {
        const runtime = runtimeForRosterSource(storedId, bucket.owner, sources)

        const source = collaborationSourceFor(
          runtime,
          rows,
          storedId,
          bucket.owner,
          bucket.sourceScopesBySession?.[storedId]
        )

        const eventTasks = runtime ? (history[runtime] ?? []) : []

        const snapshot = workers.filter(
          worker =>
            !eventTasks.some(
              event =>
                event.id === worker.id &&
                (event.updatedAt >= bucket.at || (event.status !== 'running' && event.status !== 'queued'))
            )
        )

        sources.push({ ...source, canControl: Boolean(runtime), taskSnapshot: snapshot })
      }
    }

    return stableGroups(collaborationGroupsFor(sources, history, translateNow('agents.defaultGoal')))
  }
)

export class CollaborationTaskActionError extends Error {
  constructor(
    readonly code: 'owner-unavailable' | 'not-running' | 'request-failed',
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'CollaborationTaskActionError'
  }
}

async function controlCollaborationTask(
  task: CollaborationTask,
  action: 'interrupt' | 'steer',
  text?: string
): Promise<void> {
  if (!task.canControl || !collaborationOwnerKey(task.owner) || !task.parentRuntimeId) {
    throw new CollaborationTaskActionError('owner-unavailable')
  }

  if (task.status !== 'running' && task.status !== 'queued') {
    throw new CollaborationTaskActionError('not-running')
  }

  try {
    const result = await requestForSessionProfile<{ found?: boolean; status?: string }>(
      task.owner,
      async () => {
        throw new CollaborationTaskActionError('owner-unavailable')
      },
      `subagent.${action}`,
      { session_id: task.parentRuntimeId, subagent_id: task.id, ...(action === 'steer' ? { text } : {}) }
    )

    if (action === 'steer' ? result.status !== 'queued' : !result.found) {
      throw new CollaborationTaskActionError('request-failed')
    }
  } catch (error) {
    throw error instanceof CollaborationTaskActionError
      ? error
      : new CollaborationTaskActionError('request-failed', { cause: error })
  }
}

/** Route the captured task to its own owner, even after the foreground changes. */
export function interruptCollaborationTask(task: CollaborationTask): Promise<void> {
  return controlCollaborationTask(task, 'interrupt')
}

export function steerCollaborationTask(task: CollaborationTask, text: string): Promise<void> {
  const message = text.trim()

  return message
    ? controlCollaborationTask(task, 'steer', message)
    : Promise.reject(new CollaborationTaskActionError('request-failed'))
}
