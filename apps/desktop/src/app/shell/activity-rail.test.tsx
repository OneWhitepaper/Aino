import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import {
  $workspaceIsPage,
  CRON_ROUTE,
  ROUTES_AREA,
  sessionRoute,
  SIDEBAR_NAV_AREA,
  syncWorkspaceRoute
} from '@/app/routes'
import { findGroup, group, split } from '@/components/pane-shell/tree/model'
import { $hiddenTreePanes, $layoutTree, isPaneVisible, watchContributedPanes } from '@/components/pane-shell/tree/store'
import { $workspaceMode, $workspaceOwnerKey, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import { I18nProvider } from '@/i18n'
import { $hudActive } from '@/store/hud'
import { $interfaceMode } from '@/store/interface-mode'
import { $activeGatewayProfile, $newChatProfile } from '@/store/profile'
import { $routeTiles, closeRouteTile } from '@/store/route-tiles'
import { $selectedStoredSessionId } from '@/store/session'
import { $settingsScopeOverride, $settingsScopeProfile } from '@/store/settings-scope'
import { SIDEBAR_NAV_PREFS_AREA } from '@/store/sidebar-nav'
import { stubMenuDomApis } from '@/test/jsdom'

import { watchRouteTiles } from '../chat/route-tile'

import { ActivityRail } from './activity-rail'

vi.mock('./sidebar-identity-footer', () => ({ SidebarIdentityFooter: () => <span>Account</span> }))
vi.mock('@/store/profile', async original => ({
  ...(await original<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn(async () => undefined),
  ensureGatewayProfile: vi.fn(async () => undefined)
}))

const botPaneId = 'test-bots:roster'
const disposers: (() => void)[] = []

beforeAll(() => {
  watchRouteTiles()
  watchContributedPanes()
})

function RouteProbe() {
  const location = useLocation()

  useEffect(() => syncWorkspaceRoute(location.pathname), [location.pathname])

  return <output data-testid="route">{location.pathname}</output>
}

function mount(path = '/') {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <MemoryRouter initialEntries={[path]}>
        <ActivityRail />
        <RouteProbe />
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => {
  $activeGatewayProfile.set('default')
  $settingsScopeOverride.set(null)
  stubMenuDomApis()
  $workspaceIsPage.set(false)
  $interfaceMode.set('advanced')
  $selectedStoredSessionId.set(null)
  $hiddenTreePanes.set(new Set())
  setWorkspaceScope('sessions')
  $hudActive.set(false)
  vi.unstubAllGlobals()
  disposers.push(
    registry.registerMany([
      {
        area: 'panes',
        id: 'workspace',
        title: 'Conversation',
        data: { placement: 'main', uncloseable: true },
        render: () => null
      },
      {
        area: 'panes',
        id: 'sessions',
        title: 'Sessions',
        data: { placement: 'left', sidebarMode: 'sessions', hideOnly: true },
        render: () => null
      },
      {
        area: 'panes',
        id: botPaneId,
        title: 'Test bots',
        data: { placement: 'left', sidebarMode: 'bots', hideOnly: true },
        render: () => null
      }
    ])
  )
  $layoutTree.set(
    split('row', [group(['sessions', botPaneId], { id: 'navigation' }), group(['workspace'], { id: 'main' })])
  )
})

it('returns to Aino without losing its existing conversation and pins future chats to Aino', () => {
  $selectedStoredSessionId.set('retained-chat')
  $activeGatewayProfile.set('writer')
  $newChatProfile.set('writer')
  setWorkspaceScope('bots', 'bot:writer')
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Aino' }))

  expect($workspaceMode.get()).toBe('sessions')
  expect($selectedStoredSessionId.get()).toBe('retained-chat')
  expect($newChatProfile.get()).toBe('default')
})

it('opens global settings for Aino after Bot-specific settings were selected', () => {
  $activeGatewayProfile.set('writer')
  $settingsScopeOverride.set('research')
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

  expect(screen.getByTestId('route').textContent).toBe('/settings')
  expect($settingsScopeProfile.get()).toBe('default')
})

afterEach(() => {
  cleanup()

  for (const tile of $routeTiles.get()) {
    closeRouteTile(tile.path)
  }

  $layoutTree.set(null)
  disposers.splice(0).forEach(dispose => dispose())
  $workspaceIsPage.set(false)
  $selectedStoredSessionId.set(null)
  $interfaceMode.set('advanced')
  setWorkspaceScope('sessions')
})

it('navigates to registered plugin pages and preserves their preferences and interface tier', () => {
  disposers.push(
    registry.registerMany([
      { area: ROUTES_AREA, id: 'test:board', data: { path: '/test-board' }, render: () => null },
      {
        area: SIDEBAR_NAV_AREA,
        id: 'test:board-nav',
        data: { path: '/test-board', label: 'Project board', codicon: 'project', tier: 'advanced' }
      }
    ])
  )
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Project board' }))
  expect(screen.getByTestId('route').textContent).toBe('/test-board')
  expect(screen.getByRole('button', { name: 'Project board' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('button', { name: 'Aino' }).getAttribute('aria-current')).toBeNull()

  let releasePreference: () => void

  act(() => {
    releasePreference = registry.register({
      area: SIDEBAR_NAV_PREFS_AREA,
      id: 'test:hide-board',
      data: { hide: ['test:board-nav'] }
    })
  })
  expect(screen.queryByRole('button', { name: 'Project board' })).toBeNull()
  act(() => releasePreference())
  expect(screen.getByRole('button', { name: 'Project board' })).toBeTruthy()
  act(() => $interfaceMode.set('simple'))
  expect(screen.queryByRole('button', { name: 'Project board' })).toBeNull()
  act(() => $interfaceMode.set('advanced'))
  expect(screen.getByRole('button', { name: 'Project board' })).toBeTruthy()
})

it('keeps session import named and reachable from the activity menu', async () => {
  mount()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Import session' }))
  expect(screen.getByTestId('route').textContent).toBe('/session-import')
  expect($workspaceIsPage.get()).toBe(true)
})

it('retains the floating chat action in the activity menu', async () => {
  const open = vi.fn()
  vi.stubGlobal('hermesDesktop', { hud: { open } })
  mount()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'HUD mode' }))
  expect(open).toHaveBeenCalledOnce()
})

it.each([
  { label: 'Aino', pane: 'sessions', expectedMode: 'sessions', expectedOwner: null },
  { label: 'Test bots', pane: botPaneId, expectedMode: 'bots', expectedOwner: 'bot:retained-owner' }
] as const)('leaves the scheduled-jobs page for $label without losing the saved conversation', item => {
  $selectedStoredSessionId.set('retained-chat')
  setWorkspaceScope('bots', 'bot:retained-owner')
  mount(CRON_ROUTE)
  expect($workspaceIsPage.get()).toBe(true)
  expect(screen.getByRole('button', { name: item.label }).getAttribute('aria-current')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: item.label }))
  expect(screen.getByTestId('route').textContent).toBe(sessionRoute('retained-chat'))
  expect($workspaceIsPage.get()).toBe(false)
  expect($selectedStoredSessionId.get()).toBe('retained-chat')
  expect($workspaceMode.get()).toBe(item.expectedMode)
  expect($workspaceOwnerKey.get()).toBe(item.expectedOwner)
  expect(findGroup($layoutTree.get()!, 'navigation')?.active).toBe(item.pane)
})

it('returns from a full page before opening a visible plugin page split', async () => {
  disposers.push(
    registry.registerMany([
      { area: ROUTES_AREA, id: 'test:board', data: { path: '/test-board' }, render: () => null },
      {
        area: SIDEBAR_NAV_AREA,
        id: 'test:board-nav',
        data: { path: '/test-board', label: 'Project board', codicon: 'project' }
      }
    ])
  )
  $selectedStoredSessionId.set('retained-chat')
  mount('/settings')
  expect($workspaceIsPage.get()).toBe(true)
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Project board' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Open in split/i }))
  expect(screen.getByTestId('route').textContent).toBe(sessionRoute('retained-chat'))
  expect($selectedStoredSessionId.get()).toBe('retained-chat')
  expect($workspaceIsPage.get()).toBe(false)
  expect($routeTiles.get()).toEqual([{ path: '/test-board', dir: 'right' }])
  expect(isPaneVisible('route-tile:/test-board')).toBe(true)
})
