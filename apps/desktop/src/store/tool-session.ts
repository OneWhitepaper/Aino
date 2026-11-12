import { atom, computed } from 'nanostores'

import { findGroup, findGroupOfPane, type LayoutNode } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree, isSessionStripPane } from '@/components/pane-shell/tree/store'
import { desktopFsCacheKey } from '@/lib/desktop-fs'

import { $connectionsRegistry } from './connection-registry-state'
import { $activeGatewayProfile, $profiles } from './profile'
import {
  $activeSessionId,
  $connection,
  $currentBranch,
  $currentCwd,
  $currentModel,
  $currentProvider,
  $selectedStoredSessionId,
  $sessions,
  $workspaceCwdOwner,
  sessionMatchesStoredId
} from './session'
import { ambientGatewayOwnsEverySession } from './session-owner-resolution'
import type { SessionOwnerScope } from './session-request-router'
import { $sessionOwnerHoldRevision, $sessionStates, $sessionTiles, knownOwnerForSession } from './session-states'

/** Tool focus does not change the conversation being worked on. Tab/close and
 * navigation still use the layout's existing keyboard-focus policy. */
export function resolveToolSessionPane(tree: LayoutNode | null, groupId: string | null, previous: string): string {
  const active = tree && groupId ? findGroup(tree, groupId)?.active : undefined

  if (active && isSessionStripPane(active)) {
    return active
  }

  const main = tree ? findGroupOfPane(tree, 'workspace')?.active : undefined
  const fallback = main && isSessionStripPane(main) ? main : 'workspace'

  // A primary navigation explicitly clears the active group.
  if (!tree || !groupId) {
    return fallback
  }

  const previousGroup = findGroupOfPane(tree, previous)

  if (!previousGroup) {
    return fallback
  }

  return isSessionStripPane(previousGroup.active) ? previousGroup.active : previous
}

const $toolPane = atom('workspace')

const syncToolPane = () => {
  $toolPane.set(resolveToolSessionPane($layoutTree.get(), $activeTreeGroup.get(), $toolPane.get()))
}

$activeTreeGroup.subscribe(syncToolPane)
$layoutTree.listen(syncToolPane)

const $storedId = computed([$toolPane, $selectedStoredSessionId], (pane, selected) =>
  pane === 'workspace' ? selected : pane.slice('session-tile:'.length)
)

const $runtimeId = computed(
  [$toolPane, $storedId, $activeSessionId, $sessionTiles, $sessionStates, $sessions],
  (pane, storedId, mainRuntime, tiles, states, sessions) => {
    const runtime =
      pane === 'workspace' ? mainRuntime : tiles.find(tile => tile.storedSessionId === storedId)?.runtimeId

    const boundId = runtime ? states[runtime]?.storedSessionId : null
    const row = sessions.find(session => storedId && sessionMatchesStoredId(session, storedId))

    return runtime && storedId && boundId && (boundId === storedId || (row && sessionMatchesStoredId(row, boundId)))
      ? runtime
      : null
  }
)

const $state = computed([$runtimeId, $sessionStates], (runtime, states) => (runtime ? states[runtime] : undefined))
const $busy = computed($state, state => Boolean(state?.busy))

const $cwd = computed(
  [$toolPane, $storedId, $state, $currentCwd, $workspaceCwdOwner],
  (pane, stored, state, cwd, owner) =>
    (pane === 'workspace' ? (owner === stored ? cwd : '') : (state?.cwd ?? '')).trim()
)

const $owner = computed(
  [$runtimeId, $storedId, $sessions, $sessionTiles, $sessionOwnerHoldRevision],
  (runtime, stored) => knownOwnerForSession(runtime ?? stored)
)

export function resolveToolSessionScope(
  owner: SessionOwnerScope,
  connectionId = $connection.get()?.connectionId,
  activeProfile = $activeGatewayProfile.get()
) {
  return {
    connectionId: typeof owner === 'string' ? 'local' : owner?.connectionId || connectionId || 'local',
    profile: (typeof owner === 'string' ? owner : owner?.profile) || activeProfile || 'default'
  }
}

const $scope = computed([$owner, $connection, $activeGatewayProfile], (owner, connection, activeProfile) =>
  resolveToolSessionScope(owner, connection?.connectionId, activeProfile)
)

const $sourceKey = computed([$connection, $activeGatewayProfile], (connection, profile) =>
  JSON.stringify([desktopFsCacheKey(connection), profile || 'default'])
)

export const $toolSession = computed(
  [$storedId, $runtimeId, $busy, $cwd, $owner, $scope, $toolPane, $sourceKey],
  (storedId, runtimeId, busy, cwd, owner, scope, pane, sourceKey) => ({
    busy,
    cwd,
    owner,
    runtimeId,
    scope,
    storedId,
    sourceKey,
    target: pane === 'workspace' ? 'main' : `tile:${storedId}`
  })
)

export type ToolSession = ReturnType<typeof $toolSession.get>

/** A shell can use another profile on this same host, but must never borrow
 * a path from an unknown owner or another connection. */
export function toolSessionHasCurrentConnection(session: Pick<ToolSession, 'owner' | 'scope' | 'storedId'>): boolean {
  return (
    (!session.storedId || Boolean(session.owner) || ambientGatewayOwnsEverySession()) &&
    session.scope.connectionId === ($connection.get()?.connectionId || 'local')
  )
}

/** Filesystem/Git bridges belong to the foreground profile as well as its host. */
export function toolSessionHasCurrentSource(session: Pick<ToolSession, 'owner' | 'scope' | 'storedId'>): boolean {
  return (
    toolSessionHasCurrentConnection(session) && session.scope.profile === ($activeGatewayProfile.get() || 'default')
  )
}

export function toolSessionIsCurrent(
  session: Pick<ToolSession, 'cwd' | 'storedId' | 'owner' | 'scope'> & { sourceKey?: string }
): boolean {
  const current = $toolSession.get()

  return (
    toolSessionHasCurrentSource(session) &&
    current.storedId === session.storedId &&
    current.cwd === session.cwd &&
    current.scope.connectionId === session.scope.connectionId &&
    current.scope.profile === session.scope.profile &&
    (!session.sourceKey || current.sourceKey === session.sourceKey)
  )
}

export const $toolWorkspaceCwd = computed([$toolSession, $connectionsRegistry, $profiles], session =>
  toolSessionHasCurrentSource(session) ? session.cwd : ''
)

// Coarse values only: a token in any transcript must not repaint tool chrome.
export const $toolSessionModel = computed(
  [$state, $toolPane, $currentModel],
  (state, pane, draft) => state?.model ?? (pane === 'workspace' ? draft : '')
)
export const $toolSessionProvider = computed(
  [$state, $toolPane, $currentProvider],
  (state, pane, draft) => state?.provider ?? (pane === 'workspace' ? draft : '')
)
export const $toolSessionBranch = computed(
  [$state, $toolPane, $currentBranch],
  (state, pane, draft) => state?.branch ?? (pane === 'workspace' ? draft : '')
)
