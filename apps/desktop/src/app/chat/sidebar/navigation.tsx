import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { Codicon } from '@/components/ui/codicon'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { TipKeybindLabel } from '@/components/ui/tooltip'
import type { Contribution } from '@/contrib/types'
import { comboTokens } from '@/lib/keybinds/combo'
import { cn } from '@/lib/utils'
import { recordAction } from '@/store/desktop-metrics'
import { $bindings } from '@/store/keybinds'
import { $newChatProfile } from '@/store/profile'
import { exitProjectScope } from '@/store/project-scope'
import { openRouteTile } from '@/store/route-tiles'

import type { AppView, SidebarNavContribution } from '../../routes'
import type { SidebarNavItem } from '../../types'
import { type NewSessionSplitHandler, startNewSessionDrag } from '../new-session-drag'

import { CONTEXT_SPLIT_KIT, SplitSubmenu } from './split-submenu'

export function contributedSidebarNav(contributions: readonly Contribution[]): SidebarNavItem[] {
  return contributions.flatMap(contribution => {
    const data = contribution.data as Partial<SidebarNavContribution> | undefined

    if (!data?.path?.startsWith('/') || !data.label) {
      return []
    }

    const codicon = data.codicon || 'plug'

    return [
      {
        id: contribution.id,
        label: data.label,
        icon: (props: { className?: string }) => <Codicon name={codicon} {...props} />,
        route: data.path,
        tier: data.tier
      }
    ]
  })
}

const ACTIVE_VIEWS: Record<string, AppView> = {
  skills: 'capabilities',
  profiles: 'profiles',
  messaging: 'messaging',
  artifacts: 'artifacts',
  cron: 'cron'
}

interface SidebarNavigationProps {
  currentView: AppView
  pathname: string
  navItems: SidebarNavItem[]
  navLabels: Record<string, string>
  openInSplit: string
  onNavigate: (item: SidebarNavItem) => void
  onNewSessionInWorkspace: (path: null | string, options?: { openTab?: boolean }) => void
  onNewSessionSplit: NewSessionSplitHandler
}

export function SidebarNavigation({
  currentView,
  pathname,
  navItems,
  navLabels,
  openInSplit,
  onNavigate,
  onNewSessionInWorkspace,
  onNewSessionSplit
}: SidebarNavigationProps) {
  const newSessionCombo = useStore($bindings)['session.new']?.[0]
  const newSessionKbd = newSessionCombo ? comboTokens(newSessionCombo) : []
  const [newSessionKbdFlash, setNewSessionKbdFlash] = useState(false)
  // Flash the ⌘N hint full-opacity (no transition) for the press, so hitting
  // the shortcut visibly pings its affordance in the sidebar.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined

    const onShortcut = () => {
      setNewSessionKbdFlash(true)
      clearTimeout(timeout)
      timeout = setTimeout(() => setNewSessionKbdFlash(false), 140)
    }

    window.addEventListener('hermes:new-session-shortcut', onShortcut)

    return () => {
      window.removeEventListener('hermes:new-session-shortcut', onShortcut)
      clearTimeout(timeout)
    }
  }, [])

  return (
    <>
      <div aria-hidden="true" className="aino-sidebar-brand">
        <BrandMark className="size-8" />
        <span>Aino</span>
      </div>
      <SidebarGroup className="shrink-0 p-0 pt-2">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0">
            {navItems.map(item => {
              const isInteractive = Boolean(item.action) || Boolean(item.route)

              const active =
                ACTIVE_VIEWS[item.id] === currentView ||
                (currentView === 'extension' && Boolean(item.route) && pathname === item.route)

              const isNewSession = item.id === 'new-session'

              const button = (
                <SidebarMenuButton
                  aria-disabled={!isInteractive}
                  className={cn(
                    // no-drag: these rows sit directly under the titlebar's
                    // [-webkit-app-region:drag] strips (app-shell.tsx), with only
                    // 6px of clearance. Drag regions win hit-testing over DOM
                    // (pointer-events can't override), and on Linux/WSLg the
                    // resolved region has been observed to swallow clicks on the
                    // top rows. Same carve-out as USER_BUBBLE_BASE_CLASS in
                    // thread.tsx.
                    'flex h-8 w-full justify-start gap-2.5 rounded-lg border-0 px-2.5 py-1.5 text-left text-[length:var(--aino-text-ui)] leading-5 font-normal transition-colors duration-100 ease-out [-webkit-app-region:no-drag] hover:bg-(--ui-control-hover-background) hover:text-foreground hover:transition-none',
                    active && 'bg-(--ui-control-active-background) text-foreground',
                    !isInteractive && 'cursor-default hover:border-transparent hover:bg-transparent hover:text-inherit'
                  )}
                  // A tip anchored to the label points at the end of the
                  // word; the row is what it's actually about.
                  data-tip-region=""
                  isActive={active}
                  onClick={() => {
                    // A plain new session lands in whatever profile the live
                    // gateway is on (= the active switcher context). null →
                    // no swap. The switcher header is the single place to
                    // change which profile that is.
                    if (isNewSession) {
                      $newChatProfile.set(null)
                      exitProjectScope()
                      onNewSessionInWorkspace(null, { openTab: false })

                      return
                    }

                    if (item.keybindActionId) {
                      recordAction(item.keybindActionId, 'click')
                    }

                    onNavigate(item)
                  }}
                  onPointerDown={event => {
                    // The "New session" row is a drag source too: drag it onto
                    // a chat zone's tab strip / edge / center to create the
                    // session exactly there (stack / split). The pointer drag
                    // session owns the gesture — a sub-threshold release falls
                    // through to the onClick above (ordinary new session), and
                    // an engaged drag suppresses that click so it never
                    // double-creates. The create callback sets $newChatProfile
                    // itself (the suppressed click can't), so a dragged new
                    // session lands in the same profile a click would.
                    if (!isNewSession) {
                      return
                    }

                    startNewSessionDrag(placement => {
                      $newChatProfile.set(null)
                      onNewSessionSplit(placement.dir, { anchor: placement.anchor, before: placement.before })
                    }, event)
                  }}
                  tooltip={
                    item.keybindActionId
                      ? {
                          children: (
                            <TipKeybindLabel actionId={item.keybindActionId} text={navLabels[item.id] ?? item.label} />
                          )
                        }
                      : (navLabels[item.id] ?? item.label)
                  }
                  type="button"
                >
                  <span className="grid size-5 shrink-0 place-items-center" data-slot="sidebar-nav-icon">
                    <item.icon className="size-[18px]" />
                  </span>
                  {/* Shrink-to-fit, not flex-1: the label carries the row's
                        `data-tour` handle, and anything anchored to it should
                        land at the end of the WORD, not out at the sidebar's
                        edge. Still truncates — `min-w-0` lets it shrink past
                        its content when the rail is narrow — and the trailing
                        chip's `ml-auto` was already doing the pushing that
                        `flex-1` looked like it was for.
                        Its own `sidebar-nav-` namespace: the overlay nav owns
                        `nav-<id>`, and both are on screen with Settings open. */}
                  <span className="min-w-0 truncate" data-tip-arrow-only="" data-tour={`sidebar-nav-${item.id}`}>
                    {navLabels[item.id] ?? item.label}
                  </span>
                  {isNewSession && (
                    <span
                      aria-label={newSessionKbd.join(' ')}
                      className={cn(
                        'ml-auto text-[0.6875rem] font-normal text-(--ui-text-quaternary) opacity-55',
                        newSessionKbdFlash && 'opacity-100!'
                      )}
                    >
                      {newSessionKbd.join(' ')}
                    </span>
                  )}
                </SidebarMenuButton>
              )

              // New session + route-backed pages can open in a split —
              // right-click for the directional "Open in split" submenu.
              return (
                <SidebarMenuItem key={item.id}>
                  {isNewSession || item.route ? (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
                      <ContextMenuContent aria-label={navLabels[item.id] ?? item.label}>
                        <SplitSubmenu
                          kit={CONTEXT_SPLIT_KIT}
                          label={openInSplit}
                          onSplit={dir => {
                            if (isNewSession) {
                              onNewSessionSplit(dir)
                            } else if (item.route) {
                              openRouteTile(item.route, dir)
                            }
                          }}
                        />
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    button
                  )}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}
