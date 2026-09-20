import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { type CommandCenterSection } from '@/app/command-center'
import {
  AGENTS_ROUTE,
  appViewForPath,
  COMMAND_CENTER_ROUTE,
  isOverlayView,
  NEW_CHAT_ROUTE,
  STARMAP_ROUTE
} from '@/app/routes'

const SECTIONS = ['sessions', 'system', 'usage'] as const

export function useOverlayRouting() {
  const location = useLocation()
  const navigate = useNavigate()

  const currentView = appViewForPath(location.pathname)
  const settingsOpen = currentView === 'settings'
  const commandCenterOpen = currentView === 'command-center'
  const agentsOpen = currentView === 'agents'
  const starmapOpen = currentView === 'starmap'
  const cronOpen = currentView === 'cron'
  const webhooksOpen = currentView === 'webhooks'
  const chatOpen = currentView === 'chat'
  const overlayOpen = isOverlayView(currentView)

  // Route-owned surfaces (settings/command-center/agents) stash the underlying
  // path so closing them returns there instead of bouncing to /.
  const returnPathRef = useRef(NEW_CHAT_ROUTE)
  // Keep the last non-route-owned destination separately. Settings can launch
  // the command center; after that overlay closes, Settings must still be able
  // to use its own Back button to leave for the original chat/page.
  const nonRouteReturnPathRef = useRef(NEW_CHAT_ROUTE)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    // Settings is a full-page workspace, not an OverlayView, but it still owns
    // a return affordance. Do not replace the chat/page we came from while the
    // settings route is active, otherwise Back would navigate to /settings.
    if (!settingsOpen && !overlayOpen) {
      const currentPath = `${location.pathname}${location.search}${location.hash}`
      returnPathRef.current = currentPath
      nonRouteReturnPathRef.current = currentPath
    }
  }, [location.hash, location.pathname, location.search, overlayOpen, settingsOpen])

  const commandCenterInitialSection = useMemo<CommandCenterSection | undefined>(
    () => SECTIONS.find(value => value === new URLSearchParams(location.search).get('section')),
    [location.search]
  )

  // Settings is a route-owned page that can launch the command center. Capture
  // that page before navigating so closing the command center returns to the
  // same settings tab instead of the chat route that originally opened it.
  const rememberSettingsReturnPath = useCallback(() => {
    if (!settingsOpen) {
      return
    }

    returnPathRef.current = `${location.pathname}${location.search}${location.hash}`
  }, [location.hash, location.pathname, location.search, settingsOpen])

  const openCommandCenterSection = useCallback(
    (section: CommandCenterSection) => {
      rememberSettingsReturnPath()
      navigate(`${COMMAND_CENTER_ROUTE}?section=${section}`)
    },
    [navigate, rememberSettingsReturnPath]
  )

  const resetOverlayReturnRoute = useCallback(() => {
    returnPathRef.current = NEW_CHAT_ROUTE
  }, [])

  const closeOverlayToPreviousRoute = useCallback(() => {
    const target = returnPathRef.current || NEW_CHAT_ROUTE

    // A command-center launch from Settings temporarily changes the shared
    // return target to `/settings`. Restore the outer chat/page target as
    // soon as that overlay closes, otherwise Settings' own Back control
    // would navigate to itself forever.
    if (appViewForPath(target) === 'settings') {
      returnPathRef.current = nonRouteReturnPathRef.current || NEW_CHAT_ROUTE
    }

    navigate(target, { replace: true })
  }, [navigate])

  const toggleCommandCenter = useCallback(() => {
    if (commandCenterOpen) {
      closeOverlayToPreviousRoute()
    } else {
      rememberSettingsReturnPath()
      navigate(COMMAND_CENTER_ROUTE)
    }
  }, [closeOverlayToPreviousRoute, commandCenterOpen, navigate, rememberSettingsReturnPath])

  const openAgents = useCallback(() => navigate(AGENTS_ROUTE), [navigate])
  const openStarmap = useCallback(() => navigate(STARMAP_ROUTE), [navigate])

  return {
    agentsOpen,
    chatOpen,
    closeOverlayToPreviousRoute,
    commandCenterInitialSection,
    commandCenterOpen,
    cronOpen,
    currentView,
    openAgents,
    openCommandCenterSection,
    openStarmap,
    resetOverlayReturnRoute,
    settingsOpen,
    starmapOpen,
    toggleCommandCenter,
    webhooksOpen
  }
}
