/**
 * Wiring surfaces — each pane is its own memoized component. Every surface
 * reads the reactive state it renders from at the leaf (its own atom
 * subscriptions) and reaches the controller's callbacks through the stable
 * `actions` bag, so a state change scoped to one surface (or a bare
 * wiring-controller tick) never re-renders another. This is what keeps the
 * layout tree's zones independently rendered — the whole point of the shell.
 */

import { useStore } from '@nanostores/react'
import { type ComponentProps, lazy, memo, type ReactNode, Suspense, useMemo } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'

import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import { $activeGatewayConnectionId, $gateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'

import { ChatView } from '../chat'
import { ChatSidebar } from '../chat/sidebar'
import { TerminalPaneChrome } from '../right-sidebar/terminal/chrome'
import { contributedRoutes, NEW_CHAT_ROUTE, ROUTES_AREA, sessionRoute } from '../routes'
import { ModelMenuPanel } from '../shell/model-menu-panel'
import { ReasoningMenuPanel } from '../shell/reasoning-menu-panel'

import { latestChatActions, latestSidebarActions } from './latest-actions'
import { setStatusbarItemGroup } from './panes'
import type { SidebarActions, WiringActions } from './types'

// Same lazy-view split as DesktopController — pages load on demand. The
// full-page views the workspace route table mounts live here; modal overlays
// (agents/command-center/…) are the controller's and stay in wiring.tsx.
const ArtifactsView = lazy(async () => ({ default: (await import('../artifacts')).ArtifactsView }))
const MessagingView = lazy(async () => ({ default: (await import('../messaging')).MessagingView }))
const ProfilesView = lazy(async () => ({ default: (await import('../profiles')).ProfilesView }))
const CapabilitiesView = lazy(async () => ({ default: (await import('../capabilities')).CapabilitiesView }))

export function LegacySessionRedirect() {
  const { sessionId } = useParams()

  return <Navigate replace to={sessionId ? sessionRoute(sessionId) : NEW_CHAT_ROUTE} />
}

export const SidebarSurface = memo(function SidebarSurface({
  actions,
  currentView
}: {
  actions: SidebarActions
  currentView: ComponentProps<typeof ChatSidebar>['currentView']
}) {
  const latestActions = useMemo(() => latestSidebarActions(actions), [actions])

  return <ChatSidebar currentView={currentView} {...latestActions} />
})

export const TerminalSurface = memo(function TerminalSurface() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-(--ui-terminal-surface-background)">
      <TerminalPaneChrome />
    </div>
  )
})

/** The workspace pane: the real route table (chat + full-page views + plugin
 *  routes). Subscribes to the gateway instance/state and ROUTES_AREA itself;
 *  the voice cap arrives as a prop. ChatView subscribes to its own session
 *  atoms, so streaming never round-trips through the controller. */
export const ChatRoutesSurface = memo(function ChatRoutesSurface({
  actions,
  maxVoiceRecordingSeconds
}: {
  actions: WiringActions
  maxVoiceRecordingSeconds?: number
}) {
  const activeGatewayProfile = useStore($activeGatewayProfile)
  const gateway = useStore($gateway)
  const gatewayState = useStore($gatewayState)
  const activeModelConnectionId = useStore($activeGatewayConnectionId)
  const routeSnapshot = useContributions(ROUTES_AREA)
  const routeContributions = contributedRoutes(routeSnapshot)

  const modelMenuContent = useMemo(
    () =>
      gatewayState === 'open' ? (
        <ModelMenuPanel
          gateway={gateway || undefined}
          onSelectModel={actions.selectModel}
          ownerConnectionId={activeModelConnectionId || undefined}
          profile={activeGatewayProfile}
          requestGateway={actions.requestGateway}
        />
      ) : null,
    [actions, activeGatewayProfile, activeModelConnectionId, gateway, gatewayState]
  )

  const reasoningMenuContent = useMemo(
    () =>
      gatewayState === 'open' ? (
        <ReasoningMenuPanel
          gateway={gateway || undefined}
          onSelectModel={actions.selectModel}
          ownerConnectionId={activeModelConnectionId || undefined}
          profile={activeGatewayProfile}
          requestGateway={actions.requestGateway}
        />
      ) : null,
    [actions, activeModelConnectionId, activeGatewayProfile, gateway, gatewayState]
  )

  const chatActions = useMemo(() => latestChatActions(actions), [actions])

  const chatView = (
    <ChatView
      gateway={gateway}
      maxVoiceRecordingSeconds={maxVoiceRecordingSeconds}
      modelMenuContent={modelMenuContent}
      modelOptionsOwnerConnectionId={activeModelConnectionId || undefined}
      modelOptionsProfile={activeGatewayProfile}
      reasoningMenuContent={reasoningMenuContent}
      requestModelOptionsForOwner={actions.requestGateway}
      {...chatActions}
    />
  )

  // FULL-PAGE views (not chat): a page is not a tab-able surface, so the zone's
  // tab strip stands down while one is showing. That is `paneChrome.headerVeto`
  // on the contribution, not a DOM marker — the `data-zone-no-header` attribute
  // that used to ride this wrapper gated a body double-click toggle that no
  // longer exists, and nothing has read it since.
  const page = (view: ReactNode) => (
    <div className="contents">
      <Suspense fallback={null}>{view}</Suspense>
    </div>
  )

  return (
    <Routes>
      <Route element={chatView} index />
      <Route element={chatView} path=":sessionId" />
      <Route element={page(<CapabilitiesView setStatusbarItemGroup={setStatusbarItemGroup} />)} path="capabilities" />
      <Route element={page(<MessagingView setStatusbarItemGroup={setStatusbarItemGroup} />)} path="messaging" />
      <Route element={page(<ArtifactsView setStatusbarItemGroup={setStatusbarItemGroup} />)} path="artifacts" />
      <Route element={null} path="agents" />
      <Route element={null} path="command-center" />
      <Route element={null} path="cron" />
      <Route element={page(<ProfilesView />)} path="profiles" />
      <Route element={null} path="settings" />
      <Route element={null} path="starmap" />
      <Route element={null} path="webhooks" />
      {/* Registry-contributed pages (core features + plugins) render in the
          workspace pane like any built-in view — behind the same blast wall
          as every other contribution mount. */}
      {routeContributions.map(route => (
        <Route
          element={page(
            <div
              className="flex h-full min-h-0 min-w-0 flex-col overflow-auto"
              data-aino-contributed-page
              data-aino-page-shell
            >
              <ContribBoundary id={route.key}>
                <ContribRender render={route.render} />
              </ContribBoundary>
            </div>
          )}
          key={route.key}
          path={route.path.slice(1)}
        />
      ))}
      <Route element={<Navigate replace to={NEW_CHAT_ROUTE} />} path="new" />
      <Route element={<LegacySessionRedirect />} path="sessions/:sessionId" />
      <Route element={<Navigate replace to={NEW_CHAT_ROUTE} />} path="*" />
    </Routes>
  )
})
