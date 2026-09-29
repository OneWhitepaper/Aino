import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { $activeGatewayRoute, setPrimaryGateway } from '@/store/gateway'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  $gatewayState,
  $modelPickerOpen,
  setConnection
} from '@/store/session'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { ModelPickerOverlay } from './model-picker-overlay'

vi.mock('@/lib/model-options', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestModelOptions: vi.fn(async () => ({
    providers: [{ name: 'Custom fixture', slug: 'custom:fixture', models: ['fixture-next'] }]
  }))
}))

stubMenuDomApis()
stubResizeObserver()
afterEach(() => {
  cleanup()
  $activeSessionId.set(null)
  $currentModel.set('')
  $currentProvider.set('')
  $modelPickerOpen.set(false)
  $activeGatewayProfile.set('default')
  $activeGatewayRoute.set('default')
  setPrimaryGateway(null, 'default')
  setConnection(null)
  clearGatewayManagedCapabilities()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('preserves the awaited result from the overlay action through the real dialog', async () => {
  $activeSessionId.set('runtime-fixture')
  $currentProvider.set('custom:fixture')
  $currentModel.set('fixture-old')
  $gatewayState.set('open')
  $modelPickerOpen.set(true)
  const pending = deferred<boolean>()
  const select = vi.fn(() => pending.promise)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelPickerOverlay onSelect={select} requestGateway={vi.fn()} />
    </QueryClientProvider>
  )
  const row = await screen.findByRole('option', { name: 'fixture-next' })
  fireEvent.click(row)
  expect(select).toHaveBeenCalledWith({
    provider: 'custom:fixture',
    model: 'fixture-next',
    sessionId: 'runtime-fixture'
  })
  expect($modelPickerOpen.get()).toBe(true)
  await act(async () => pending.resolve(false))
  expect($modelPickerOpen.get()).toBe(true)
  select.mockResolvedValueOnce(true)
  fireEvent.click(row)
  await waitFor(() => expect($modelPickerOpen.get()).toBe(false))
})

it('shows Aino models for a profile-only active socket even when the presentation descriptor is local', async () => {
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
  setPrimaryGateway({ connectionState: 'open' } as never, 'fixture-workspace')
  setConnection({ connectionId: 'local', mode: 'local', profile: 'fixture-workspace' } as never)
  $activeGatewayRoute.set('fixture-workspace')
  $activeGatewayProfile.set('fixture-workspace')
  recordGatewayReadyCapability(
    { profile: 'fixture-workspace' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  $gatewayState.set('open')
  $modelPickerOpen.set(true)

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelPickerOverlay onSelect={vi.fn()} requestGateway={vi.fn()} />
    </QueryClientProvider>
  )

  expect(await screen.findByRole('option', { name: /Fixture Model/ })).toBeTruthy()
  expect(screen.queryByText('This connection does not support Aino models')).toBeNull()
})
