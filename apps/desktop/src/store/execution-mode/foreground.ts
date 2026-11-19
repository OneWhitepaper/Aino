import { computed } from 'nanostores'

import type { ExecutionMode } from '@/lib/execution-mode'

import { $activeGatewayProfile, resolveNewChatOwnerRoute } from '../profile'
import { $activeSessionId, $connection, $selectedStoredSessionId } from '../session'
import { $focusedSessionIsTile, $focusedStoredSessionId } from '../session-focus'
import { isSessionOwnerRoute, type SessionOwnerRoute } from '../session-request-router'
import { $sessionStates, $sessionTiles, knownOwnerForSession } from '../session-states'

/** Chrome focus must retain the interacted conversation, not silently follow main. */
export const $executionForegroundId = computed(
  [$focusedSessionIsTile, $focusedStoredSessionId, $selectedStoredSessionId],
  (tile, focused, selected) => (tile ? focused : selected)
)

export function runtimeExecutionMode(storedId: string): ExecutionMode | undefined {
  const tile = $sessionTiles.get().find(candidate => candidate.storedSessionId === storedId)
  const runtimeId = tile?.runtimeId ?? (storedId === $selectedStoredSessionId.get() ? $activeSessionId.get() : null)

  return runtimeId ? $sessionStates.get()[runtimeId]?.executionMode : undefined
}

export const $foregroundRuntimeMode = computed(
  [$executionForegroundId, $sessionTiles, $sessionStates, $activeSessionId],
  storedId => (storedId ? runtimeExecutionMode(storedId) : undefined)
)

export function sessionExecutionScope(storedId: string, accountScope: string): string {
  const [environment, account] = JSON.parse(accountScope) as string[]
  const owner = knownOwnerForSession(storedId)
  const connection = $connection.get()

  const connectionId = isSessionOwnerRoute(owner)
    ? owner.connectionId
    : (connection?.connectionId ?? (connection?.mode === 'remote' ? connection.baseUrl : 'local'))

  const profile = isSessionOwnerRoute(owner) ? owner.profile : owner || $activeGatewayProfile.get()

  return JSON.stringify([environment, account, connectionId ?? '', profile])
}

export function ownerMatchesExecutionScope(scope: string, owner: SessionOwnerRoute): boolean {
  const [, , connectionId, profile] = JSON.parse(scope) as string[]

  return owner.connectionId === connectionId && owner.profile === profile
}

export function storedExecutionOwnerMatches(scope: string, storedId: string): boolean {
  const owner = knownOwnerForSession(storedId)

  return !isSessionOwnerRoute(owner) || ownerMatchesExecutionScope(scope, owner)
}

/** Restore the captured route, including remote profile aliases, not a new-chat pin. */
export function executionWorkspaceOwner(scope: string, storedId?: string | null): SessionOwnerRoute | undefined {
  const known = storedId ? knownOwnerForSession(storedId) : undefined

  if (isSessionOwnerRoute(known) && ownerMatchesExecutionScope(scope, known)) {
    return known
  }

  const draft = resolveNewChatOwnerRoute()

  if (draft && ownerMatchesExecutionScope(scope, draft)) {
    return draft
  }

  const [, , connectionId, profile] = JSON.parse(scope) as string[]

  return $connection.get()?.connectionId === connectionId ? { connectionId, profile } : undefined
}
