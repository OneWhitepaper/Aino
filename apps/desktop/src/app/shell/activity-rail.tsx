import './activity-rail.css'

import { useStore } from '@nanostores/react'
import {
  BookOpen,
  Box,
  CircleHelp,
  Clock,
  Download,
  Ellipsis,
  House,
  MessagesSquare,
  PanelsTopLeft,
  Settings2
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { contributedSidebarNav } from '@/app/chat/sidebar/navigation'
import { BUILTIN_SIDEBAR_NAV } from '@/app/chat/sidebar/navigation-items'
import { CONTEXT_SPLIT_KIT, SplitSubmenu } from '@/app/chat/sidebar/split-submenu'
import { hudTargetSessionId } from '@/app/hud/handoff'
import { revealSessionWorkspace } from '@/app/open-session'
import {
  appViewForPath,
  navigateToWorkspacePage,
  SESSION_IMPORT_ROUTE,
  SETTINGS_ROUTE,
  SIDEBAR_NAV_AREA
} from '@/app/routes'
import { prepareDefaultNewSession } from '@/app/session/new-session-route'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { revealTreePane } from '@/components/pane-shell/tree/store'
import { $workspaceMode, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { BotModeIcon } from '@/components/ui/bot-mode-icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { useContributions } from '@/contrib/react/use-contributions'
import { useI18n } from '@/i18n'
import { DOCUMENTATION_URL } from '@/lib/brand'
import { openExternalLink } from '@/lib/external-link'
import { recordAction } from '@/store/desktop-metrics'
import { canUseHud, toggleHud } from '@/store/hud'
import { $interfaceMode, shownInMode } from '@/store/interface-mode'
import { openRouteTile } from '@/store/route-tiles'
import { setSettingsScope } from '@/store/settings-scope'
import { applySidebarNavPrefs, SIDEBAR_NAV_PREFS_AREA } from '@/store/sidebar-nav'

import { ActivityUpdate } from './activity-update'
import { SidebarIdentityFooter } from './sidebar-identity-footer'

const ACTIVITY_ICONS = {
  profiles: PanelsTopLeft,
  skills: BookOpen,
  messaging: MessagesSquare,
  artifacts: Box,
  cron: Clock
}

interface RailButtonProps {
  label: string
  active?: boolean
  children: ReactNode
  onClick: () => void
}

function RailButton({ label, active, children, onClick }: RailButtonProps) {
  return (
    <Tip label={label} side="right">
      <Button
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        className="aino-activity-button"
        data-active={active || undefined}
        onClick={onClick}
        size="icon"
        variant="ghost"
      >
        {children}
      </Button>
    </Tip>
  )
}

/** One app-wide navigation surface; conversation panes keep their own state. */
export function ActivityRail() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const mode = useStore($workspaceMode)
  const interfaceMode = useStore($interfaceMode)
  const panes = useContributions('panes')
  const contributions = useContributions(SIDEBAR_NAV_AREA)
  const preferences = useContributions(SIDEBAR_NAV_PREFS_AREA)

  const items = applySidebarNavPrefs(
    [...BUILTIN_SIDEBAR_NAV, ...contributedSidebarNav(contributions)].filter(
      item => item.route && shownInMode(interfaceMode)(item)
    ),
    preferences
  )

  const primary = items.filter(item => !['artifacts', 'cron'].includes(item.id))
  const secondary = items.filter(item => ['artifacts', 'cron'].includes(item.id))
  const conversation = appViewForPath(location.pathname) === 'chat'
  const modes = panes.filter(pane => (pane.data as { sidebarMode?: string } | undefined)?.sidebarMode)

  function selectMode(paneId: string) {
    revealSessionWorkspace(navigate)

    if (paneId === 'sessions') {
      prepareDefaultNewSession()
      setWorkspaceScope('sessions')
    }

    revealTreePane(paneId)
    window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: paneId, mode: 'open' } }))
  }

  return (
    <nav aria-label={t.zones.sidebarModeMenu} className="aino-activity-rail" data-aino-activity-rail="">
      {modes.map(pane => {
        const ownMode = (pane.data as { sidebarMode: string }).sidebarMode
        const label = ownMode === 'sessions' ? 'Aino' : String(pane.title || t.common.bots)

        return (
          <RailButton
            active={conversation && mode === ownMode}
            key={pane.id}
            label={label}
            onClick={() => selectMode(pane.id)}
          >
            {ownMode === 'sessions' ? <House /> : <BotModeIcon />}
          </RailButton>
        )
      })}
      <span aria-hidden="true" className="aino-activity-separator" />
      {primary.map(item => {
        const label = t.sidebar.nav[item.id] || item.label
        const Icon = ACTIVITY_ICONS[item.id as keyof typeof ACTIVITY_ICONS] || item.icon

        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger asChild>
              <span>
                <RailButton
                  active={location.pathname === item.route}
                  label={label}
                  onClick={() => {
                    if (item.keybindActionId) {
                      recordAction(item.keybindActionId, 'click')
                    }

                    navigateToWorkspacePage(navigate, item.route!)
                  }}
                >
                  <Icon className="size-5" />
                </RailButton>
              </span>
            </ContextMenuTrigger>
            <ContextMenuContent aria-label={label}>
              <SplitSubmenu
                kit={CONTEXT_SPLIT_KIT}
                label={t.sidebar.row.openInSplit}
                onSplit={direction => {
                  revealSessionWorkspace(navigate)
                  openRouteTile(item.route!, direction)
                }}
              />
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <DropdownMenu>
        <Tip label={t.common.actions} side="right">
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t.common.actions}
              className="aino-activity-button"
              data-active={secondary.some(item => item.route === location.pathname) || undefined}
              size="icon"
              variant="ghost"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" side="right">
          {secondary.map(item => {
            const Icon = ACTIVITY_ICONS[item.id as keyof typeof ACTIVITY_ICONS] || item.icon

            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <DropdownMenuItem onSelect={() => navigateToWorkspacePage(navigate, item.route!)}>
                    <Icon className="size-4" />
                    {t.sidebar.nav[item.id] || item.label}
                  </DropdownMenuItem>
                </ContextMenuTrigger>
                <ContextMenuContent aria-label={t.sidebar.nav[item.id] || item.label}>
                  <SplitSubmenu
                    kit={CONTEXT_SPLIT_KIT}
                    label={t.sidebar.row.openInSplit}
                    onSplit={direction => {
                      revealSessionWorkspace(navigate)
                      openRouteTile(item.route!, direction)
                    }}
                  />
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
          <DropdownMenuItem onSelect={() => navigateToWorkspacePage(navigate, SESSION_IMPORT_ROUTE)}>
            <Download />
            {t.sessionImport.action}
          </DropdownMenuItem>
          {canUseHud() && (
            <DropdownMenuItem onSelect={() => toggleHud(hudTargetSessionId())}>
              <MessagesSquare />
              {t.titlebar.enterHud}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="aino-activity-spacer" />
      <ActivityUpdate />
      <RailButton label={t.common.docs} onClick={() => openExternalLink(DOCUMENTATION_URL)}>
        <CircleHelp />
      </RailButton>
      <RailButton
        active={location.pathname === SETTINGS_ROUTE}
        label={t.titlebar.openSettings}
        onClick={() => {
          setSettingsScope('default')
          navigateToWorkspacePage(navigate, SETTINGS_ROUTE)
        }}
      >
        <Settings2 />
      </RailButton>
      <SidebarIdentityFooter compact />
    </nav>
  )
}
