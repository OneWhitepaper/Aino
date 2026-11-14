import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { type ComponentProps, type MouseEvent, type ReactNode, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { hudTargetSessionId } from '@/app/hud/handoff'
import { NotificationStack } from '@/components/notifications'
import { $paneVisible, togglePaneVisible } from '@/components/pane-shell/tree/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SidebarToggleIcon } from '@/components/ui/sidebar-toggle-icon'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { Slot } from '@/contrib/react/slot'
import { useContributions } from '@/contrib/react/use-contributions'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { recordAction } from '@/store/desktop-metrics'
import { canUseHud, toggleHud } from '@/store/hud'
import { $interfaceMode, shownInMode, type Tiered } from '@/store/interface-mode'
import { $panesFlipped } from '@/store/layout'
import { $unreadSessionCount } from '@/store/session-dot-state'
import { TITLEBAR_FIXED_TOOLS } from '@/store/titlebar-app-actions'

import { appViewForPath, hidesFixedTitlebarClusters, isRouteBlockingSurface } from '../routes'

import { SummaryToggle } from './summary-toggle'
import { TITLEBAR_CHROME_CHANGED_EVENT, titlebarButtonClass, titlebarToolClusterClass } from './titlebar'
import { TitlebarHistoryControls } from './titlebar-history-controls'
import { TitlebarIcon } from './titlebar-icon'
import { type TitlebarHistoryState, useTitlebarHistory } from './use-titlebar-history'
import { useTitlebarPanelEdges } from './use-titlebar-panel-edges'

export interface TitlebarTool extends Tiered {
  id: string
  label: string
  active?: boolean
  expanded?: boolean
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  icon: ReactNode
  onSelect?: (event?: MouseEvent) => void
  /** Keybind action id — when set, the tooltip shows the label + keybind hint. */
  actionId?: string
  /** Overlay count on the glyph (unread sessions). Hidden when 0/undefined. */
  badge?: number
  title?: string
  to?: string
  /** Durable `data-tour` handle. Tools are addressed by icon and translated
   *  label otherwise, and neither survives a theme or a locale change. */
  tour?: string
}

export type TitlebarToolSide = 'left' | 'right'
export type SetTitlebarToolGroup = (id: string, tools: readonly TitlebarTool[], side?: TitlebarToolSide) => void

interface TitlebarControlsProps extends ComponentProps<'div'> {
  leftTools?: readonly TitlebarTool[]
  tools?: readonly TitlebarTool[]
}

/** Overlay count on a titlebar glyph. Hidden when count is 0/undefined. */
function withCountBadge(icon: ReactNode, count: number | undefined): ReactNode {
  if (!count) {
    return icon
  }

  return (
    <span className="relative inline-flex">
      {icon}
      <span className="pointer-events-none absolute -top-2.5 -right-1.5 z-1">
        <Badge aria-hidden size="overlay" variant="solid">
          {compactNumber(count)}
        </Badge>
      </span>
    </span>
  )
}

export function TitlebarControls({ leftTools = [], tools = [] }: TitlebarControlsProps) {
  const { t } = useI18n()
  const location = useLocation()
  const history = useTitlebarHistory()
  const panesFlipped = useStore($panesFlipped)
  const unreadCount = useStore($unreadSessionCount)
  const terminalVisible = useStore($paneVisible('terminal'))
  const unreadBadge = unreadCount > 0 ? unreadCount : undefined
  const unreadHint = unreadBadge ? ` · ${t.titlebar.unreadSessions(unreadBadge)}` : ''

  // `titleBar.*` slot content is mount-scoped — a page's <Contribute> registers
  // only while that surface is up — so a non-empty area means a page is
  // actively projecting chrome into the band right now.
  const titleBarLeft = useContributions('titleBar.left')
  const titleBarRight = useContributions('titleBar.right')
  const pageOwnsTitlebar = titleBarLeft.length + titleBarRight.length > 0

  // POSITIONAL toggles: each button shows/hides everything on its physical
  // side of the main zone (the layout tree collapses the whole side), so they
  // stay correct through flips and rearranges. Both edges resolve their column
  // from the live tree (see toggleLeftSide / toggleRightSide) — the browser
  // column, the sessions column, whatever is physically left / right. Never an
  // active highlight — plain show/hide affordances.
  const { leftEdge, rightEdge } = useTitlebarPanelEdges()
  const leftLabel = leftEdge.open ? t.titlebar.hideSidebar : t.titlebar.showSidebar
  const rightLabel = rightEdge.open ? t.titlebar.hideRightSidebar : t.titlebar.showRightSidebar

  const sidebarTool: TitlebarTool = {
    ...TITLEBAR_FIXED_TOOLS.sidebar,
    actionId: 'view.toggleSidebar',
    badge: panesFlipped ? undefined : unreadBadge,
    icon: <SidebarToggleIcon expanded={leftEdge.open} />,
    id: 'sidebar',
    expanded: leftEdge.expanded,
    label: `${leftLabel}${panesFlipped ? '' : unreadHint}`,
    onSelect: () => {
      triggerHaptic('tap')
      leftEdge.toggle()
    }
  }

  const rightSidebarTool: TitlebarTool = {
    ...TITLEBAR_FIXED_TOOLS['right-sidebar'],
    actionId: 'view.toggleRightSidebar',
    badge: panesFlipped ? unreadBadge : undefined,
    icon: <SidebarToggleIcon expanded={rightEdge.open} side="right" />,
    id: 'right-sidebar',
    expanded: rightEdge.expanded,
    label: `${rightLabel}${panesFlipped ? unreadHint : ''}`,
    onSelect: () => {
      triggerHaptic('tap')
      rightEdge.toggle()
    },
    tour: 'right-pane-toggle'
  }

  // App actions stay together on the right; history and navigation stay left.
  const systemTools: TitlebarTool[] = [
    {
      ...TITLEBAR_FIXED_TOOLS.hud,
      // No `title`: TitlebarToolButton passes `title` to TipKeybindLabel as a
      // text OVERRIDE, so a long sentence there replaces the short label and
      // crowds the ⌘⇧H hint off the tooltip. Label only — the hint is appended
      // from the action registry, same as every other tool here.
      actionId: 'view.toggleHud',
      hidden: !canUseHud(),
      icon: <TitlebarIcon name="hud" />,
      id: 'hud',
      label: t.titlebar.enterHud,
      onSelect: () => {
        triggerHaptic('open')
        toggleHud(hudTargetSessionId())
      }
    }
  ]

  const terminalTool: TitlebarTool = {
    ...TITLEBAR_FIXED_TOOLS.terminal,
    actionId: 'view.showTerminal',
    active: terminalVisible,
    icon: <TitlebarIcon name={terminalVisible ? 'layout-panel' : 'layout-panel-off'} />,
    id: 'terminal',
    label: terminalVisible ? t.rightSidebar.terminalHide : t.keybinds.actions['view.showTerminal'],
    onSelect: () => {
      triggerHaptic('tap')
      togglePaneVisible('terminal')
    }
  }

  const view = appViewForPath(location.pathname)

  // Route changes can replace measured clusters without resizing the panels.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TITLEBAR_CHROME_CHANGED_EVENT))
  }, [location.pathname, pageOwnsTitlebar])

  return (
    <TitlebarClusters
      history={history}
      leftTools={leftTools}
      pageOwnsTitlebar={pageOwnsTitlebar}
      rightSidebarTool={rightSidebarTool}
      sidebarTool={sidebarTool}
      systemTools={systemTools}
      terminalTool={terminalTool}
      tools={tools}
      view={view}
    />
  )
}

interface TitlebarClustersProps {
  history: TitlebarHistoryState
  leftTools: readonly TitlebarTool[]
  tools: readonly TitlebarTool[]
  sidebarTool: TitlebarTool
  rightSidebarTool: TitlebarTool
  terminalTool: TitlebarTool
  systemTools: readonly TitlebarTool[]
  pageOwnsTitlebar: boolean
  view: ReturnType<typeof appViewForPath>
}

function TitlebarClusters({
  history,
  leftTools,
  tools,
  sidebarTool,
  rightSidebarTool,
  terminalTool,
  systemTools,
  pageOwnsTitlebar,
  view
}: TitlebarClustersProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const interfaceMode = useStore($interfaceMode)
  // Every cluster respects the same hidden flag and interface-mode tier.
  const shown = shownInMode(interfaceMode)
  const visibleTool = (tool: TitlebarTool) => !tool.hidden && shown(tool)

  // Overlays own the window. These clusters are `fixed` at a higher z-index
  // than the overlay card, so they'd otherwise bleed over it — hide them (and
  // the nested titleBar slots) and let the overlay's own chrome take over.
  if (isRouteBlockingSurface(view) && view !== 'settings') {
    return null
  }

  const routeOwnsWindow = isRouteBlockingSurface(view)
  const pageOwnsChrome = !routeOwnsWindow && hidesFixedTitlebarClusters(view) && pageOwnsTitlebar
  const showFixedTools = !routeOwnsWindow && !pageOwnsChrome

  const leftClusterClass = cn(
    titlebarToolClusterClass,
    'left-(--titlebar-controls-left) top-(--titlebar-controls-top) gap-1'
  )

  // A contributed full page (`extension`) yields the fixed clusters only while
  // it actually projects chrome into the band — page-mounted `titleBar.*` slots
  // like kanban's board switcher. A page that mounts no titlebar chrome keeps
  // the app's controls; an empty claim would leave a bare strip on every plugin
  // route. Contributed `titleBar.tools` items keep rendering here too, so a
  // chrome-owning page never silently drops a registered item.
  const visibleLeftTools = (pageOwnsChrome ? [...leftTools, ...tools] : [sidebarTool, ...leftTools]).filter(visibleTool)
  const visibleSystemTools = systemTools.filter(visibleTool)
  const visiblePaneTools = tools.filter(visibleTool)
  const visibleEndTools = [terminalTool, rightSidebarTool].filter(visibleTool)

  return (
    <>
      {routeOwnsWindow && (
        <div className={leftClusterClass} data-titlebar-cluster="left">
          <TitlebarHistoryControls history={history} />
        </div>
      )}
      {!routeOwnsWindow && (
        <div
          aria-label={pageOwnsChrome ? undefined : t.shell.windowControls}
          className={leftClusterClass}
          data-slot={pageOwnsChrome ? undefined : 'titlebar-window-controls'}
          data-titlebar-cluster="left"
        >
          <TitlebarHistoryControls history={history} />
          {visibleLeftTools.map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
          {pageOwnsChrome && <Slot area="titleBar.left" />}
        </div>
      )}

      {showFixedTools && visiblePaneTools.length > 0 && (
        <div
          aria-label={t.shell.paneControls}
          className={cn(
            titlebarToolClusterClass,
            'right-[calc(var(--titlebar-tools-right)+var(--shell-preview-toolbar-gap,0))] top-[calc(var(--titlebar-controls-top)+var(--right-rail-top-inset,0px))] gap-1'
          )}
          data-slot="titlebar-pane-controls"
        >
          {visiblePaneTools.map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
        </div>
      )}

      <TitlebarAppControls
        endTools={visibleEndTools}
        routeOwnsWindow={routeOwnsWindow}
        showFixedTools={showFixedTools}
        showSummary={shown({ tier: 'advanced' })}
        systemTools={visibleSystemTools}
      />
    </>
  )
}

interface TitlebarAppControlsProps {
  routeOwnsWindow: boolean
  showFixedTools: boolean
  showSummary: boolean
  systemTools: readonly TitlebarTool[]
  endTools: readonly TitlebarTool[]
}

/** The right cluster stays mounted when Settings replaces the workspace. */
function TitlebarAppControls({
  routeOwnsWindow,
  showFixedTools,
  showSummary,
  systemTools,
  endTools
}: TitlebarAppControlsProps) {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <div
      aria-label={showFixedTools ? t.shell.appControls : undefined}
      className={cn(titlebarToolClusterClass, 'right-(--titlebar-tools-right) top-(--titlebar-controls-top) gap-1')}
      data-slot={showFixedTools ? 'titlebar-app-controls' : undefined}
      data-titlebar-cluster="right"
    >
      <NotificationStack placement="toolbar" triggerClassName={titlebarButtonClass} />
      {showFixedTools && (
        <>
          {systemTools.map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
          {showSummary && <SummaryToggle />}
          {endTools.map(tool => (
            <TitlebarToolButton key={tool.id} navigate={navigate} tool={tool} />
          ))}
        </>
      )}
      {!routeOwnsWindow && <Slot area="titleBar.right" />}
    </div>
  )
}

function TitlebarToolButton({ navigate, tool }: { navigate: ReturnType<typeof useNavigate>; tool: TitlebarTool }) {
  // Titlebar actions never show an active background — state reads from the
  // icon itself (e.g. the terminal's solid/dashed panel). aria-pressed still carries it
  // for a11y.
  const className = cn(titlebarButtonClass, 'bg-transparent select-none', tool.className)

  const tooltipLabel = tool.actionId ? (
    <TipKeybindLabel actionId={tool.actionId} text={tool.title ?? tool.label} />
  ) : (
    (tool.title ?? tool.label)
  )

  if (tool.href) {
    return (
      <Tip label={tooltipLabel} placement="toolbar">
        <Button asChild className={className} size="icon-titlebar" variant="ghost">
          <a
            aria-label={tool.label}
            data-tour={tool.tour}
            href={tool.href}
            onPointerDown={event => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            {withCountBadge(tool.icon, tool.badge)}
          </a>
        </Button>
      </Tip>
    )
  }

  return (
    <Tip label={tooltipLabel} placement="toolbar">
      <Button
        aria-expanded={tool.expanded}
        aria-label={tool.label}
        aria-pressed={tool.active ?? undefined}
        className={className}
        data-tour={tool.tour}
        disabled={tool.disabled}
        onClick={event => {
          if (tool.actionId) {
            recordAction(tool.actionId, 'click')
          }

          if (tool.to) {
            navigate(tool.to)
          }

          tool.onSelect?.(event)
        }}
        onPointerDown={event => event.stopPropagation()}
        size="icon-titlebar"
        type="button"
        variant="ghost"
      >
        {withCountBadge(tool.icon, tool.badge)}
      </Button>
    </Tip>
  )
}
