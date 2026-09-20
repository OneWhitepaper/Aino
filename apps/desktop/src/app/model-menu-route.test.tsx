import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import type { HermesConnection } from '@/global'
import {
  $activeGatewayConnectionId,
  activeGatewayConnectionId,
  closeSecondaryGateways,
  configureGatewayRegistry,
  disposeSecondariesForConnection,
  ensureGatewayForAgent,
  ensureGatewayForProfile,
  reportPrimaryGatewayEvent,
  retainGatewayForRelay,
  setPrimaryGateway,
  setPrimaryGatewayConnectionId
} from '@/store/gateway'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { $activeGatewayProfile } from '@/store/profile'
import { $currentModel, $currentProvider, $gatewayState, $modelPickerOpen, setConnection } from '@/store/session'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { ChatRoutesSurface } from './contrib/surfaces'
import type { WiringActions } from './contrib/types'
import { ModelPickerOverlay } from './model-picker-overlay'

vi.mock('@/contrib/react/use-contributions', () => ({ useContributions: vi.fn() }))
vi.mock('@/lib/model-options', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestModelOptions: vi.fn(async () => ({ providers: [] }))
}))
// Keep the actual menu/controller and gateway stores; omit the unrelated chat shell.
vi.mock('./chat', () => ({ ChatView: ({ modelMenuContent }: { modelMenuContent?: ReactNode }) => modelMenuContent }))
vi.mock('./chat/sidebar', () => ({ ChatSidebar: () => null }))
vi.mock('./right-sidebar/terminal/chrome', () => ({ TerminalPaneChrome: () => null }))
vi.mock('./contrib/latest-actions', () => ({ latestChatActions: () => ({}), latestSidebarActions: () => ({}) }))
vi.mock('./contrib/panes', () => ({ setStatusbarItemGroup: vi.fn(), useStatusbarContributions: () => [] }))

stubMenuDomApis()

class MenuSocket extends EventTarget {
  static OPEN = 1
  readyState = 0

  constructor() {
    super()
    queueMicrotask(() => {
      this.readyState = MenuSocket.OPEN
      this.dispatchEvent(new Event('open'))
      this.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ method: 'event', params: { type: 'gateway.ready', payload: { managed_model_binding: 1 } } })
      }))
    })
  }

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

beforeEach(async () => {
  stubResizeObserver()
  vi.stubGlobal('WebSocket', MenuSocket)
  clearGatewayManagedCapabilities()
  configureGatewayRegistry({ onEvent: () => undefined, onActiveRouteChanged: profile => $activeGatewayProfile.set(profile) })
  setPrimaryGateway(null, 'default')
  setPrimaryGatewayConnectionId(null)
  await ensureGatewayForProfile('default')
  $activeGatewayProfile.set('default')
  $gatewayState.set('closed')
  $currentModel.set('')
  $currentProvider.set('')
  $modelPickerOpen.set(true)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
})

afterEach(() => {
  cleanup()
  closeSecondaryGateways()
  setPrimaryGateway(null, 'default')
  setPrimaryGatewayConnectionId(null)
  setConnection(null)
  clearGatewayManagedCapabilities()
  $modelPickerOpen.set(false)
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.unstubAllGlobals()
})

it.each(['inline', 'dialog'] as const)('%s menu follows exact owners through cold boot, source replacement and redial', async surface => {
  const actions = { selectModel: vi.fn(), requestGateway: vi.fn() } as unknown as WiringActions
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        {surface === 'inline' ? (
          <ChatRoutesSurface actions={actions} />
        ) : (
          <ModelPickerOverlay onSelect={actions.selectModel} requestGateway={actions.requestGateway} />
        )}
      </QueryClientProvider>
    </MemoryRouter>
  )

  const gateway = { connectionState: 'open' } as never
  await act(async () => {
    setPrimaryGateway(gateway, 'default')
    setConnection({ connectionId: 'local', mode: 'local', profile: 'default' } as never)
    setPrimaryGatewayConnectionId('local')
    reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
    await ensureGatewayForProfile('default')
  })
  expect(await screen.findByRole('option', { name: /Fixture Model/ })).toBeTruthy()

  act(() => {
    setPrimaryGatewayConnectionId('replacement-source')
    recordGatewayReadyCapability(
      { connectionId: 'foreign-source', profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
  })
  expect(screen.queryByRole('option', { name: /Fixture Model/ })).toBeNull()
  expect(screen.getByText('This connection does not support Aino models')).toBeTruthy()

  act(() => reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } }))
  expect(await screen.findByRole('option', { name: /Fixture Model/ })).toBeTruthy()

  const descriptor: HermesConnection = {
    authMode: 'token', baseUrl: 'https://fixture.invalid', connectionId: 'replacement-source',
    mode: 'remote', profile: 'isolated', token: 'fixture', wsUrl: 'wss://fixture.invalid/api/ws', sharedRemote: false,
    isFullscreen: false, nativeOverlayWidth: 0, logs: [], windowButtonPosition: null
  }

  const getConnectionFor = vi.fn(async () => descriptor)
  window.hermesDesktop!.getConnectionFor = getConnectionFor

  await act(async () => { await ensureGatewayForAgent('replacement-source', 'isolated') })
  expect(await screen.findByRole('option', { name: /Fixture Model/ })).toBeTruthy()

  for (const retained of [false, true]) {
    const release = retained ? retainGatewayForRelay('replacement-source', 'isolated') : null
    const probe = deferred<HermesConnection>()
    getConnectionFor.mockImplementationOnce(() => probe.promise)

    act(() => {
      disposeSecondariesForConnection('replacement-source', { redial: true })
      release?.()
    })

    // A pending shared-host probe leaves no active entry: neither menu may
    // keep borrowing the disposed socket's still-recorded ready evidence.
    expect(activeGatewayConnectionId()).toBeNull()
    expect($activeGatewayConnectionId.get(), retained ? 'deferred redial owner' : 'immediate redial owner').toBe(activeGatewayConnectionId())
    expect(screen.queryByRole('option', { name: /Fixture Model/ })).toBeNull()

    await act(async () => { probe.resolve(descriptor) })
    await waitFor(() => expect($activeGatewayConnectionId.get()).toBe('replacement-source'))
    expect(await screen.findByRole('option', { name: /Fixture Model/ })).toBeTruthy()
  }
})
