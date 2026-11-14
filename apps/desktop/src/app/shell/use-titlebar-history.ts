import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { type Location, useLocation, useNavigate, useNavigationType } from 'react-router'

import { AccountContext } from '@/app/account/account-context'
import { openSession, revealSessionWorkspace } from '@/app/open-session'
import { appViewForPath, routeSessionId, syncWorkspaceRoute } from '@/app/routes'
import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, noteActiveTreeGroup, revealTreePane } from '@/components/pane-shell/tree/store'
import { isConversationPane } from '@/components/pane-shell/tree/workspace-presentation'
import {
  $workspaceMode,
  $workspaceNewSessionTarget,
  $workspaceOwnerKey,
  setWorkspaceScope
} from '@/components/pane-shell/workspace-scope'
import { $registryVersion, registry } from '@/contrib/registry'
import type { HermesConnection } from '@/global'
import { $connection, $selectedStoredSessionId, knownSessionOwner, ownerLookupSessionRows } from '@/store/session'
import { $focusedStoredSessionId, $focusedTreePaneId } from '@/store/session-focus'
import { isSessionOwnerRoute } from '@/store/session-request-router'
import { $sessionTiles, type SessionTile, type SessionTileWorkspaceScope } from '@/store/session-states'
import {
  type NavigationDirection,
  windowNavigationHistory,
  type WindowNavigationTarget,
  type WindowNavigationWorkspace
} from '@/store/window-navigation-history'

import type { PlatformAccountSnapshot } from '../../../shared/platform-contract'

const unavailableAccount = atom<PlatformAccountSnapshot | null>(null)

export interface TitlebarHistoryState {
  canBack: boolean
  canForward: boolean
  back(): void
  forward(): void
}

function navigationScope(account: PlatformAccountSnapshot | null, connection: HermesConnection | null): string | null {
  if (!account?.account || !connection || !['signed_in', 'offline'].includes(account.phase)) {
    return null
  }

  return JSON.stringify([
    account.account.id,
    account.mode,
    connection.connectionId,
    connection.baseUrl,
    connection.mode
  ])
}

interface NavigationSnapshot {
  location: Pick<Location, 'pathname' | 'search' | 'hash' | 'state'>
  focusedPane: string | null | undefined
  workspace: WindowNavigationWorkspace
  tiles: readonly SessionTile[]
  preferPrimary: boolean
}

function sessionScope(storedSessionId: string, tile?: SessionTile): SessionTileWorkspaceScope {
  if (tile) {
    return {
      workspaceMode: tile.workspaceMode ?? 'sessions',
      workspaceOwnerKey: tile.workspaceOwnerKey,
      workspaceTabTitle: tile.workspaceTabTitle,
      ownerProfile: tile.ownerProfile,
      ownerRoute: tile.ownerRoute
    }
  }

  const owner = knownSessionOwner(ownerLookupSessionRows(), storedSessionId)

  return {
    workspaceMode: 'sessions',
    ...(isSessionOwnerRoute(owner) ? { ownerRoute: owner } : typeof owner === 'string' ? { ownerProfile: owner } : {})
  }
}

/** Captures visible identities only; tool focus and background activity never become visits. */
function navigationTarget({
  location,
  focusedPane,
  workspace,
  tiles,
  preferPrimary
}: NavigationSnapshot): WindowNavigationTarget {
  const target: WindowNavigationTarget = {
    path: `${location.pathname}${location.search}${location.hash}`,
    routeState: location.state,
    workspace
  }

  if (appViewForPath(location.pathname) !== 'chat') {
    return target
  }

  const routedSession = routeSessionId(location.pathname)

  // Route changes lead asynchronous main-session hydration. Do not record the
  // old focused tile against the newly selected primary route in that gap.
  const tile = !preferPrimary
    ? tiles.find(candidate => focusedPane === `session-tile:${candidate.storedSessionId}`)
    : undefined

  if (tile) {
    return {
      ...target,
      content: {
        kind: 'session',
        storedSessionId: tile.storedSessionId,
        scope: sessionScope(tile.storedSessionId, tile),
        tile: true
      }
    }
  }

  if (
    !preferPrimary &&
    focusedPane &&
    focusedPane !== 'workspace' &&
    !focusedPane.startsWith('session-tile:') &&
    isConversationPane(focusedPane)
  ) {
    return { ...target, content: { kind: 'pane', paneId: focusedPane } }
  }

  return routedSession
    ? { ...target, content: { kind: 'session', storedSessionId: routedSession, scope: sessionScope(routedSession) } }
    : target
}

function availableTarget(target: WindowNavigationTarget): boolean {
  const content = target.content

  return content?.kind !== 'pane' || registry.getArea('panes').some(pane => pane.id === content.paneId)
}

function restoreTarget(target: WindowNavigationTarget, navigate: ReturnType<typeof useNavigate>): void {
  const { mode, ownerKey, newSessionTarget } = target.workspace
  setWorkspaceScope(mode, ownerKey, newSessionTarget)
  const replayNavigate = (to: string, options?: { replace?: boolean }) => navigate(to, { ...options, replace: true })

  // A tile or contributed conversation is independent of the main route.
  // Restoring its old background route would resume a second conversation
  // whose later selection commit steals focus back from this destination.
  if (target.content?.kind === 'pane' || (target.content?.kind === 'session' && target.content.tile)) {
    revealSessionWorkspace(replayNavigate)
  } else {
    navigate(target.path, { replace: true, state: target.routeState })
    syncWorkspaceRoute(target.path.split(/[?#]/, 1)[0])
  }

  if (target.content?.kind === 'session') {
    openSession(
      target.content.storedSessionId,
      replayNavigate,
      target.content.tile ? 'tab' : 'in-place',
      target.content.scope
    )
  } else if (target.content?.kind === 'pane') {
    revealTreePane(target.content.paneId)
    const tree = $layoutTree.get()
    noteActiveTreeGroup(tree ? (findGroupOfPane(tree, target.content.paneId)?.id ?? null) : null)
  }
}

interface PendingNavigation {
  session: string
  fromPane: string | null | undefined
}

function pendingNavigationSettled(
  pending: PendingNavigation | null,
  selectedSession: string | null,
  focusedPane: string | null | undefined,
  focusedSession: string | null
): boolean {
  if (!pending) {
    return false
  }

  const primaryReady =
    selectedSession === pending.session &&
    (!focusedPane || focusedPane === 'workspace' || focusedSession === pending.session)

  const anotherConversation = Boolean(
    focusedPane && focusedPane !== pending.fromPane && focusedPane !== 'workspace' && isConversationPane(focusedPane)
  )

  return primaryReady || anotherConversation
}

/** Mounted by the window's chrome even while a route hides the navigation buttons. */
export function useTitlebarHistory(): TitlebarHistoryState {
  const accountActions = useContext(AccountContext)
  const accountStore = accountActions?.snapshot ?? unavailableAccount
  const account = useStore(accountStore)
  const connection = useStore($connection)
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const focusedPane = useStore($focusedTreePaneId)
  const focusedSession = useStore($focusedStoredSessionId)
  const selectedSession = useStore($selectedStoredSessionId)
  const mode = useStore($workspaceMode)
  const ownerKey = useStore($workspaceOwnerKey)
  const newSessionTarget = useStore($workspaceNewSessionTarget)
  const tiles = useStore($sessionTiles)
  const registryVersion = useStore($registryVersion)
  const historyState = useStore(windowNavigationHistory.state)

  // A replace navigation changes a visit; a same-URL tab change after that
  // navigation is still a fresh visit. Router's last action alone cannot tell.
  const lastRoute = useRef<{
    key: string | null
    pending: PendingNavigation | null
  }>({ key: null, pending: null })

  const scope = navigationScope(account, connection)

  useLayoutEffect(() => {
    const routeChanged = lastRoute.current.key !== location.key
    lastRoute.current.key = location.key
    const history = windowNavigationHistory.state.get()
    const destination = history.entries[history.index]
    const routedSession = routeSessionId(location.pathname)

    if (routeChanged) {
      const replayingSurface =
        history.replay && destination?.content && (destination.content.kind === 'pane' || destination.content.tile)

      lastRoute.current.pending =
        routedSession && routedSession !== selectedSession && !replayingSurface
          ? { session: routedSession, fromPane: focusedPane }
          : null
    }

    if (pendingNavigationSettled(lastRoute.current.pending, selectedSession, focusedPane, focusedSession)) {
      lastRoute.current.pending = null
    }

    windowNavigationHistory.observe(
      scope,
      scope
        ? navigationTarget({
            location,
            focusedPane,
            workspace: { mode, ownerKey, newSessionTarget },
            tiles,
            preferPrimary: Boolean(lastRoute.current.pending)
          })
        : null,
      {
        replace: routeChanged && navigationType === 'REPLACE',
        interruptReplay:
          (routeChanged && navigationType === 'PUSH') || Boolean(destination && !availableTarget(destination)),
        settled: !lastRoute.current.pending
      }
    )
  }, [
    scope,
    location,
    navigationType,
    focusedPane,
    focusedSession,
    selectedSession,
    mode,
    ownerKey,
    newSessionTarget,
    tiles,
    registryVersion
  ])

  useEffect(() => () => windowNavigationHistory.observe(null, null), [])

  const move = (direction: NavigationDirection) => {
    // An identity change can precede React's next chrome commit.
    if (navigationScope(accountStore.get(), $connection.get()) !== windowNavigationHistory.state.get().scope) {
      windowNavigationHistory.observe(null, null)

      return
    }

    const target = windowNavigationHistory.move(direction, availableTarget)

    if (target) {
      restoreTarget(target, navigate)
    }
  }

  return {
    canBack: !historyState.replay && historyState.entries.slice(0, historyState.index).some(availableTarget),
    canForward: !historyState.replay && historyState.entries.slice(historyState.index + 1).some(availableTarget),
    back: () => move(-1),
    forward: () => move(1)
  }
}
