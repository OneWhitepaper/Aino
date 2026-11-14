import type { HermesConnection } from '@/global'

import { desktopWindowChrome } from '../../../shared/window-chrome'

export const TITLEBAR_HEIGHT = desktopWindowChrome.titlebarHeight
/** Browser touch targets retain their native 44px band. */
export const TOUCH_TITLEBAR_HEIGHT = 44
/** Permanent native drag target beside a top-edge tab strip. */
export const TITLEBAR_DRAG_HANDLE_WIDTH = 48
export const MACOS_TRAFFIC_LIGHTS_HEIGHT = desktopWindowChrome.trafficLightHeight
/** Titlebar tool hit target (both axes). */
export const TITLEBAR_CONTROL_SIZE = 24
/** Shared outline glyph box in titlebar clusters. */
export const TITLEBAR_ICON_SIZE = 18
export const TITLEBAR_CONTROL_OFFSET_X = 65
export const TITLEBAR_CONTROL_HEIGHT = TITLEBAR_CONTROL_SIZE
export const TITLEBAR_CONTROLS_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2
export const TITLEBAR_TOOL_GAP = 4
export const TITLEBAR_TOOLS_RIGHT_INSET = 17

/** Glyph sizing for titlebar icons, including contributed Codicon fallbacks. */
export function titlebarIconSizeCss(scale = 1): string {
  return `${TITLEBAR_ICON_SIZE * scale}px`
}

export const TITLEBAR_FALLBACK_WINDOW_BUTTON_X = desktopWindowChrome.trafficLightPosition.x
// Preserve other platforms' first paint until native window state arrives.
const TITLEBAR_NON_MAC_FALLBACK_WINDOW_BUTTON_X = 24
// Edge inset used when no left-side native controls take up that space —
// Windows/Linux (native overlay is on the right) and macOS fullscreen
// (traffic lights are hidden). Matches the right-cluster's 0.75rem padding.
export const TITLEBAR_EDGE_INSET = 14

export interface TitlebarChromeContext {
  darwinMajor?: number
  isFullscreen?: boolean
  windowButtonPosition?: HermesConnection['windowButtonPosition']
}

/** Right-cluster inset — WCO width when present; macOS fullscreen matches left edge inset. */
export function titlebarToolsRightCss(
  nativeOverlayWidth: number,
  { darwinMajor = 0, isFullscreen = false }: Pick<TitlebarChromeContext, 'darwinMajor' | 'isFullscreen'> = {}
): string {
  if (nativeOverlayWidth > 0) {
    return `${nativeOverlayWidth}px`
  }

  if (isFullscreen && darwinMajor > 0) {
    return `${TITLEBAR_EDGE_INSET}px`
  }

  return `${TITLEBAR_TOOLS_RIGHT_INSET}px`
}

// Titlebar palette only. All sizing/radius/cursor/centering come from the
// shared <Button size="icon-titlebar"> (used polymorphically via asChild) —
// Button is the single source of button styling.
export const titlebarButtonClass =
  'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-(--ui-text-primary)'

/** Shared flex shell for left/right/pane titlebar tool rows. */
export const titlebarToolClusterClass =
  'fixed z-70 flex flex-row items-center pointer-events-auto select-none [-webkit-app-region:no-drag]'

/** Width reserved for N titlebar buttons plus the approved four-pixel visual rhythm. */
export function titlebarToolsWidthCss(toolCount: number): string {
  return `calc(${toolCount} * var(--titlebar-control-size) + ${Math.max(0, toolCount - 1)} * ${TITLEBAR_TOOL_GAP}px)`
}

export const titlebarHeaderBaseClass =
  'pointer-events-none relative z-3 flex h-(--titlebar-height) w-full min-w-0 shrink-0 items-center justify-start gap-3 overflow-hidden border-b border-(--aino-workbench-divider) bg-(--ui-chat-surface-background) px-[max(0.75rem,var(--titlebar-content-inset,0rem))] pr-[calc(var(--titlebar-tools-right,0.75rem)+var(--titlebar-tools-width,0px)+0.75rem)]'

// Title row inside the header — must stay in the flex truncate chain.
export const titlebarHeaderTitleClass = 'min-w-0 flex-1 overflow-hidden'

export const titlebarHeaderShadowClass =
  "after:pointer-events-none after:absolute after:left-0 after:right-0 after:top-full after:h-4 after:bg-linear-to-b after:from-(--ui-chat-surface-background) after:to-transparent after:content-['']"

export function titlebarControlsPosition(
  windowButtonPosition: HermesConnection['windowButtonPosition'] | undefined,
  isFullscreen = false,
  zoomFactor = 1
) {
  const top = Math.max(0, TITLEBAR_CONTROLS_TOP)

  // No left-side native controls to dodge:
  //   - Windows/Linux: native min/max/close render on the right via titleBarOverlay.
  //   - macOS fullscreen: traffic lights are hidden.
  // In both cases, pin the cluster to the edge with a small inset.
  if (windowButtonPosition === null || isFullscreen) {
    return { left: TITLEBAR_EDGE_INSET, top }
  }

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const fallbackX = isMac ? TITLEBAR_FALLBACK_WINDOW_BUTTON_X : TITLEBAR_NON_MAC_FALLBACK_WINDOW_BUTTON_X
  const nativePosition = windowButtonPosition ?? (isMac ? desktopWindowChrome.trafficLightPosition : undefined)
  const factor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

  // Electron reports DIP coordinates; page zoom scales renderer CSS pixels.
  // Center every toolbar cluster on the native lights, without a second nudge.
  if (nativePosition) {
    return {
      left: (nativePosition.x + TITLEBAR_CONTROL_OFFSET_X) / factor,
      top: Math.max(0, (nativePosition.y + MACOS_TRAFFIC_LIGHTS_HEIGHT / 2) / factor - TITLEBAR_CONTROL_HEIGHT / 2)
    }
  }

  return {
    left: fallbackX + TITLEBAR_CONTROL_OFFSET_X,
    top
  }
}

/** Rebind panel measurements after titlebar nodes or their positions change. */
export const TITLEBAR_CHROME_CHANGED_EVENT = 'hermes:titlebar-chrome-changed'
