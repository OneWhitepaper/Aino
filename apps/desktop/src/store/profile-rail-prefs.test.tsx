// @vitest-environment jsdom
// Loaded once at collection, outside every hook's budget: vi.resetModules() keeps each module's
// transformed code, so the fresh copy a test imports only re-evaluates it. Without this each
// host's hook pays the cold transform of the whole graph and times out on a loaded runner.
import '@/app/chat/sidebar'
import '@/app/shell/hooks/use-statusbar-items'
import '@/components/pane-shell/tree/model'
import '@/components/pane-shell/tree/store'
import '@/components/ui/sidebar'
import '@/store/profile-rail-prefs'

import { act, cleanup, render, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Aino keeps workspace switching in the brand menu / Agent Hub, without an
// upstream profile strip in ChatSidebar. The optional diagnostics bar retains
// its preference-controlled profile picker. Each host gets its own module graph.

type SurfaceWindow = Window & { __HERMES_UI_SURFACE__?: string }

const noop = () => {}

const noopAsync = async () => {}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

async function importHost(webapp: boolean) {
  window.document.documentElement.dataset.hermesDesktopHost = webapp ? 'browser' : 'native'

  if (webapp) {
    ;(window as SurfaceWindow).__HERMES_UI_SURFACE__ = 'webapp'
  }

  vi.resetModules()

  const [{ ChatSidebar }, { SidebarProvider }, { useStatusbarItems }, { group }, { $layoutTree }, prefs, statusbar] =
    await Promise.all([
      import('@/app/chat/sidebar'),
      import('@/components/ui/sidebar'),
      import('@/app/shell/hooks/use-statusbar-items'),
      import('@/components/pane-shell/tree/model'),
      import('@/components/pane-shell/tree/store'),
      import('@/store/profile-rail-prefs'),
      import('@/store/statusbar-prefs')
    ])

  statusbar.$statusbarVisible.set(true)

  return { $layoutTree, ChatSidebar, group, prefs, SidebarProvider, useStatusbarItems }
}

type HostModules = Awaited<ReturnType<typeof importHost>>

function renderDoors({ $layoutTree, ChatSidebar, group, SidebarProvider, useStatusbarItems }: HostModules) {
  // The sessions pane is on screen: both doors live with it.
  $layoutTree.set(group(['sessions'], { active: 'sessions', id: 'sessions-group' }))

  const sidebar = render(
    <MemoryRouter>
      <SidebarProvider>
        <ChatSidebar
          currentView="chat"
          onArchiveSession={noop}
          onBranchSession={noop}
          onDeleteSession={noop}
          onLoadMoreSessions={noop}
          onManageCronJob={noop}
          onNavigate={noop}
          onNewSessionInWorkspace={noop}
          onNewSessionSplit={noop}
          onResumeSession={noop}
          onRetrySessions={noopAsync}
          onTriggerCronJob={noopAsync}
        />
      </SidebarProvider>
    </MemoryRouter>
  )

  const statusbar = renderHook(
    () =>
      useStatusbarItems({
        agentsOpen: false,
        changeSessionCwd: noopAsync,
        chatOpen: true,
        commandCenterOpen: false,
        extraLeftItems: [],
        extraRightItems: [],
        freshDraftReady: false,
        gatewayState: 'ready',
        inferenceStatus: null,
        openAgents: noop,
        openCommandCenterSection: noop,
        requestGateway: async () => undefined as never,
        statusSnapshot: null,
        toggleCommandCenter: noop
      }),
    { wrapper: MemoryRouter }
  )

  const doors = () => ({
    dropdown: sidebar.container.querySelector('[data-slot="profile-dropdown"]') !== null,
    picker: statusbar.result.current.leftStatusbarItems.some(item => item.id === 'profile-switcher' && !item.hidden),
    rail: sidebar.container.querySelector('[data-slot="profile-rail"]') !== null
  })

  return doors
}

describe.each([
  { host: 'Webapp', webapp: true },
  { host: 'native Desktop', webapp: false }
])('$host', ({ webapp }) => {
  let host: HostModules

  beforeAll(async () => {
    host = await importHost(webapp)
  })

  afterAll(() => {
    delete (window as SurfaceWindow).__HERMES_UI_SURFACE__
    delete window.document.documentElement.dataset.hermesDesktopHost
    vi.resetModules()
  })

  it('keeps the Aino sidebar and preference-controlled diagnostics picker on both hosts', () => {
    const doors = renderDoors(host)

    expect(doors()).toEqual({ dropdown: false, picker: false, rail: false })

    // Opting into the fallback exposes the existing picker, without adding a rail.
    act(() => host.prefs.toggleProfileRailVisible())
    expect(doors()).toEqual({ dropdown: false, picker: true, rail: false })
    act(() => host.prefs.toggleProfileRailVisible())
    expect(doors()).toEqual({ dropdown: false, picker: false, rail: false })
  })
})
