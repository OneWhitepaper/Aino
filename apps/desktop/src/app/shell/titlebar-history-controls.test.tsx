import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { StrictMode, useLayoutEffect } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { AccountContext } from '@/app/account/account-context'
import { syncWorkspaceRoute } from '@/app/routes'
import { group } from '@/components/pane-shell/tree/model'
import {
  $activeTreeGroup,
  $layoutTree,
  activateTreePane,
  noteActiveTreeGroup
} from '@/components/pane-shell/tree/store'
import { $workspaceMode, $workspaceOwnerKey, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import type { HermesConnection } from '@/global'
import { I18nProvider } from '@/i18n'
import type { AccountActions } from '@/store/account'
import { $connection, $selectedStoredSessionId } from '@/store/session'
import { $focusedStoredSessionId, $focusedTreePaneId } from '@/store/session-focus'
import { $sessionTiles } from '@/store/session-states'
import { windowNavigationHistory } from '@/store/window-navigation-history'

import type { PlatformAccountSnapshot } from '../../../shared/platform-contract'

import { TitlebarHistoryControls } from './titlebar-history-controls'
import { useTitlebarHistory } from './use-titlebar-history'

const snapshot = atom<PlatformAccountSnapshot | null>(null)
const actions = { snapshot } as AccountActions

const account = (id: string): PlatformAccountSnapshot => ({
  revision: 1,
  phase: 'signed_in',
  mode: 'development',
  remember_state: 'session_only',
  error: null,
  account: { id, display_name: id, phone_masked: '', email: '' }
})

const connection = (mode: 'local' | 'remote' = 'local'): HermesConnection => ({
  baseUrl: 'http://localhost:3111',
  connectionId: 'local',
  mode,
  isFullscreen: false,
  nativeOverlayWidth: 0,
  token: '',
  wsUrl: '',
  logs: [],
  windowButtonPosition: null
})

let dispose = () => {}

beforeEach(() => {
  windowNavigationHistory.observe(null, null)
  snapshot.set(account('first-account'))
  $connection.set(connection())
  setWorkspaceScope('sessions')
  syncWorkspaceRoute('/primary')
  $activeTreeGroup.set(null)
  $selectedStoredSessionId.set('primary')
  $sessionTiles.set([
    { storedSessionId: 'second', workspaceMode: 'sessions' },
    {
      storedSessionId: 'bot-chat',
      workspaceMode: 'bots',
      workspaceOwnerKey: 'bot:exact',
      ownerRoute: { connectionId: 'local', profile: 'helper' }
    }
  ])
  $layoutTree.set(
    group(['workspace', 'session-tile:second', 'session-tile:bot-chat', 'room:exact', 'files'], { id: 'main' })
  )
  dispose = registry.registerMany([
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    { id: 'files', area: 'panes', data: { placement: 'right', toolPanel: true }, render: () => null },
    {
      id: 'session-tile:second',
      area: 'panes',
      data: { placement: 'main', tabPresentation: 'conversation' },
      render: () => null
    },
    {
      id: 'session-tile:bot-chat',
      area: 'panes',
      data: {
        placement: 'main',
        tabPresentation: 'conversation',
        workspaceScope: { mode: 'bots', ownerKey: 'bot:exact' }
      },
      render: () => null
    },
    {
      id: 'room:exact',
      area: 'panes',
      data: {
        placement: 'main',
        tabPresentation: 'conversation',
        workspaceScope: { mode: 'bots', ownerKey: 'group:exact' }
      },
      render: () => null
    }
  ])
})

afterEach(() => {
  cleanup()
  dispose()
  setWorkspaceScope('sessions')
  $connection.set(null)
  $sessionTiles.set([])
  $selectedStoredSessionId.set(null)
  $activeTreeGroup.set(null)
  $layoutTree.set(null)
})

function Fixture() {
  const history = useTitlebarHistory()
  const location = useLocation()
  const navigate = useNavigate()
  const focused = useStore($focusedStoredSessionId)
  const pane = useStore($focusedTreePaneId)
  const mode = useStore($workspaceMode)
  const owner = useStore($workspaceOwnerKey)
  useLayoutEffect(() => syncWorkspaceRoute(location.pathname), [location.pathname])

  return (
    <>
      <TitlebarHistoryControls history={history} />
      <button onClick={() => navigate('/settings?section=models')}>Models</button>
      <button onClick={() => navigate('/other')}>Other chat</button>
      <output data-testid="route">{location.pathname}</output>
      <output data-testid="focus">{focused}</output>
      <output data-testid="pane">{pane}</output>
      <output data-testid="workspace">
        {mode}:{owner}
      </output>
    </>
  )
}

function mount() {
  render(
    <StrictMode>
      <AccountContext.Provider value={actions}>
        <I18nProvider configClient={null} initialLocale="en">
          <MemoryRouter initialEntries={['/primary']} useTransitions={false}>
            <Fixture />
          </MemoryRouter>
        </I18nProvider>
      </AccountContext.Provider>
    </StrictMode>
  )
}

function select(paneId: string) {
  activateTreePane('main', paneId)
  noteActiveTreeGroup('main')
}

it('navigates pages and already-open same-URL conversations without creating duplicate tabs', () => {
  mount()
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
  act(() => select('session-tile:second'))
  expect(screen.getByTestId('route').textContent).toBe('/primary')
  expect(screen.getByTestId('focus').textContent).toBe('second')
  act(() =>
    $sessionTiles.set(
      $sessionTiles
        .get()
        .map(tile =>
          tile.storedSessionId === 'second'
            ? { ...tile, ownerRoute: { connectionId: 'local', profile: 'default' } }
            : tile
        )
    )
  )
  expect(windowNavigationHistory.state.get().entries).toHaveLength(2)
  act(() => select('files'))
  expect(screen.getByTestId('focus').textContent).toBe('second')
  expect(windowNavigationHistory.state.get().entries).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByTestId('focus').textContent).toBe('primary')
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
  expect(screen.getByTestId('focus').textContent).toBe('second')

  fireEvent.click(screen.getByRole('button', { name: 'Models' }))
  expect(screen.getByTestId('route').textContent).toBe('/settings')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByTestId('route').textContent).toBe('/primary')
  expect(screen.getByTestId('focus').textContent).toBe('second')
  expect($sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['second', 'bot-chat'])
})

it('restores Bot and group scope through the existing panes and forgets prior account/source visits', () => {
  mount()
  act(() => {
    setWorkspaceScope('bots', 'bot:exact', { kind: 'route', route: { connectionId: 'local', profile: 'helper' } })
    select('session-tile:bot-chat')
  })
  act(() => {
    setWorkspaceScope('bots', 'group:exact', { kind: 'blocked', message: 'Choose a bot' })
    select('room:exact')
  })
  expect(screen.getByTestId('pane').textContent).toBe('room:exact')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByTestId('focus').textContent).toBe('bot-chat')
  expect(screen.getByTestId('workspace').textContent).toBe('bots:bot:exact')
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
  expect(screen.getByTestId('pane').textContent).toBe('room:exact')
  expect(screen.getByTestId('workspace').textContent).toBe('bots:group:exact')

  act(() => snapshot.set(account('second-account')))
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Models' }))
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(false)
  act(() => $connection.set(connection('remote')))
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
})

it('waits through separate route, session and pane commits without recording stale conversation focus', () => {
  mount()
  act(() => select('session-tile:second'))
  fireEvent.click(screen.getByRole('button', { name: 'Other chat' }))
  // The backend resumes the routed session after Router has already committed.
  act(() => $selectedStoredSessionId.set('other'))
  expect(windowNavigationHistory.state.get().entries).toHaveLength(3)
  act(() => select('workspace'))
  expect(windowNavigationHistory.state.get().entries).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  // Reopening a tile preserves the current primary instead of resuming its
  // historical background route and allowing that resume to steal focus.
  expect(screen.getByTestId('route').textContent).toBe('/other')
  expect($selectedStoredSessionId.get()).toBe('other')
  expect(windowNavigationHistory.state.get().entries).toHaveLength(3)
  expect(screen.getByTestId('focus').textContent).toBe('second')
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByTestId('route').textContent).toBe('/primary')
  expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(true)
  act(() => $selectedStoredSessionId.set('primary'))
  expect(screen.getByTestId('focus').textContent).toBe('primary')
  expect(windowNavigationHistory.state.get().entries).toHaveLength(3)
  expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).disabled).toBe(false)
})
