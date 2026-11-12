import { useStore } from '@nanostores/react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'
import { useLocation } from 'react-router'

import { Contribute } from '@/contrib/react/contribute'
import { $interfaceMode, shownInMode } from '@/store/interface-mode'
import { $connection } from '@/store/session'
import { $titlebarAppActionsSide, titlebarAppActionsClusterCounts } from '@/store/titlebar-app-actions'
import { isAuxiliaryWindow, isBrowserWindow, isHudWindow } from '@/store/windows'

import { CollaborationCapsule } from '../agents/collaboration-capsule'
import { appViewForPath } from '../routes'
import { useWindowControlsOverlayWidth } from '../shell/hooks/use-window-controls-overlay-width'
import {
  TITLEBAR_CHROME_CHANGED_EVENT,
  titlebarControlsPosition,
  titlebarControlsYNudge,
  titlebarToolsRightCss,
  titlebarToolsWidthCss,
  TOUCH_TITLEBAR_HEIGHT
} from '../shell/titlebar'
import { TitlebarControls } from '../shell/titlebar-controls'
import { useTouchTitlebar } from '../shell/use-touch-titlebar'
import { WslgWindowControls } from '../shell/wslg-window-controls'

import { useTitlebarToolContributions } from './panes'

// Where the fixed titlebar clusters sit (the same vars AppShell sets). Browser
// touch chrome pins them flush in its 44px band, at touch-target size.
function useTitlebarControlsVars(controlsPos: { left: number; top: number }): CSSProperties {
  const touchTitlebar = useTouchTitlebar()

  return {
    '--titlebar-controls-left': `${controlsPos.left}px`,
    '--titlebar-controls-top': `${touchTitlebar ? 0 : controlsPos.top}px`,
    ...(touchTitlebar
      ? {
          '--titlebar-control-size': `${TOUCH_TITLEBAR_HEIGHT}px`,
          '--titlebar-control-height': `${TOUCH_TITLEBAR_HEIGHT}px`
        }
      : {})
  } as CSSProperties
}

interface WiringTitlebarProps {
  children: ReactNode
}

/** Live native/browser titlebar chrome around the wired workspace. */
export function WiringTitlebar({ children }: WiringTitlebarProps) {
  const location = useLocation()
  // The REAL titlebar tool clusters (sidebar/flip toggles, haptics, keybinds,
  // settings gear) — fixed chrome positioned via the same CSS vars AppShell
  // sets, computed here from the live connection. Page-registered tools
  // (preview's monitor/devtools cluster, …) arrive as registry contributions.
  const leftTitlebarTools = useTitlebarToolContributions('left')
  const rightTitlebarTools = useTitlebarToolContributions('right')
  const connection = useStore($connection)

  const controlsPos = titlebarControlsPosition(connection?.windowButtonPosition, Boolean(connection?.isFullscreen))

  const controlsVars = useTitlebarControlsVars(controlsPos)
  // Windows/WSLg reserve native min/max/close on the right (AppShell parity:
  // prefer the live WCO measurement, fall back to the static reservation).
  const measuredOverlayWidth = useWindowControlsOverlayWidth()
  const nativeOverlayWidth = measuredOverlayWidth ?? connection?.nativeOverlayWidth ?? 0

  const titlebarChrome = {
    darwinMajor: connection?.darwinMajor ?? 0,
    isFullscreen: Boolean(connection?.isFullscreen),
    windowButtonPosition: connection?.windowButtonPosition
  }

  const titlebarToolsRight = titlebarToolsRightCss(nativeOverlayWidth, titlebarChrome)

  // WSLg: Electron's native overlay drifts its hit-region under RAIL, so the
  // renderer paints its own min/max/close (main decides via customWindowControls).
  const customWindowControls = connection?.customWindowControls ?? window.hermesDesktop?.windowControls?.custom ?? false

  const appActionsSide = useStore($titlebarAppActionsSide)
  const interfaceMode = useStore($interfaceMode)
  const shownTool = shownInMode(interfaceMode)
  const paneToolCount = rightTitlebarTools.filter(tool => !tool.hidden && shownTool(tool)).length
  const leftExtraCount = leftTitlebarTools.filter(tool => !tool.hidden && shownTool(tool)).length
  const clusters = titlebarAppActionsClusterCounts(appActionsSide, leftExtraCount, 0, interfaceMode)
  const systemToolsWidth = titlebarToolsWidthCss(clusters.right)

  const titlebarToolsWidth =
    paneToolCount > 0 ? `calc(${systemToolsWidth} + ${titlebarToolsWidthCss(paneToolCount)})` : systemToolsWidth

  const leftToolsWidth = titlebarToolsWidthCss(clusters.left)

  // Native caption reservations can translate chrome without resizing it.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TITLEBAR_CHROME_CHANGED_EVENT))
  }, [controlsPos.left, controlsPos.top, titlebarToolsRight])

  return (
    <div
      className="contents"
      style={
        {
          ...controlsVars,
          '--titlebar-controls-width': leftToolsWidth,
          '--titlebar-controls-y-nudge': titlebarControlsYNudge(titlebarChrome),
          '--titlebar-tools-right': titlebarToolsRight,
          '--titlebar-tools-width': titlebarToolsWidth,
          '--shell-preview-toolbar-gap': systemToolsWidth
        } as CSSProperties
      }
    >
      {/* HUD and the popped-out Browser have no titlebar to hang these off —
        the clusters are `fixed`, so without this they'd float over the
        surface as orphaned buttons. */}
      {!isHudWindow() && !isBrowserWindow() && (
        <TitlebarControls leftTools={leftTitlebarTools} tools={rightTitlebarTools} />
      )}
      {!isAuxiliaryWindow() && (
        <Contribute area="titleBar.center" id="collaboration:capsule">
          <CollaborationCapsule autoVisible={appViewForPath(location.pathname) === 'chat'} />
        </Contribute>
      )}
      {!isHudWindow() && customWindowControls && (
        <WslgWindowControls
          isFullscreen={Boolean(connection?.isFullscreen)}
          isMaximized={Boolean(connection?.isMaximized)}
        />
      )}
      {children}
    </div>
  )
}
