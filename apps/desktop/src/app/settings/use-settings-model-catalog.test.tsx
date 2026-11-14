import type { ModelOptionsResult } from '@hermes/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { deferred } from '@/test/deferred'

import { useSettingsModelCatalog } from './use-settings-model-catalog'

const api = vi.hoisted(() => ({ options: vi.fn(), env: vi.fn() }))

vi.mock('@/hermes', async original => ({
  ...(await original<Record<string, unknown>>()),
  getGlobalModelOptions: (...args: unknown[]) => api.options(...args),
  getEnvVars: (...args: unknown[]) => api.env(...args)
}))

const applied = { provider: 'custom:relay', model: 'saved-model' }
const originalProvider = { slug: 'custom:relay', name: 'Relay', models: ['saved-model'] }

function setup(profile = 'work') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const mount = (ownerProfile = profile) => renderHook(() => useSettingsModelCatalog(ownerProfile), { wrapper })

  return { client, mount }
}

beforeEach(() => {
  api.options.mockResolvedValue({ ...applied, providers: [originalProvider] })
  api.env.mockResolvedValue({})
  setApiRequestConnection('gateway-a')
  setApiRequestProfile('work')
})

afterEach(() => {
  cleanup()
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  vi.resetAllMocks()
})

it('shows the applied assignment immediately when revisiting the same owner', async () => {
  const { mount } = setup()
  const first = mount()
  await waitFor(() => expect(first.result.current.main).toEqual(applied))
  first.unmount()
  api.options.mockImplementation(() => new Promise(() => undefined))

  const second = mount()

  expect(second.result.current.main).toEqual(applied)
  expect(second.result.current.providers).toEqual([originalProvider])
})

it('publishes the saved model while optional credential discovery is still pending', async () => {
  const credentials = deferred<Record<string, never>>()
  api.env.mockReturnValue(credentials.promise)
  const { mount } = setup()
  const { result } = mount()

  await waitFor(() => expect(result.current.main).toEqual(applied))
  expect(result.current.providers).toEqual([originalProvider])
  expect(result.current.envVars).toEqual({})
  await act(async () => credentials.resolve({}))
})

it('keeps the main assignment when replacing providers or reading an older backend catalog', async () => {
  const { mount } = setup()
  const { result } = mount()
  await waitFor(() => expect(result.current.main).toEqual(applied))
  const replacement = { slug: 'official-provider', name: 'Official', models: ['next-model'] }

  act(() => result.current.replaceProviders([replacement]))

  expect(result.current.main).toEqual(applied)
  await waitFor(() => expect(result.current.providers).toEqual([replacement]))
  api.options.mockResolvedValue({ providers: [replacement] })
  await act(async () => result.current.refresh())
  await waitFor(() => expect(result.current.main).toEqual(applied))
})

it('does not invent an assignment when a backend omits or malforms assignment fields', async () => {
  api.options.mockResolvedValue({ provider: 'relay', model: null, providers: [] })
  const { client, mount } = setup()
  const { result } = mount()

  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(result.current.main).toBeNull()
  api.options.mockResolvedValue({ provider: '', model: '', providers: [] })
  await act(async () => result.current.refresh())
  await waitFor(() => expect(result.current.main).toEqual({ provider: '', model: '' }))
})

it('retains an authoritative assignment while an earlier catalog read completes', async () => {
  const pending = deferred<ModelOptionsResult>()
  api.options.mockReturnValueOnce(pending.promise)
  const { mount } = setup()
  const { result } = mount()
  const next = { provider: 'official-provider', model: 'new-default' }

  act(() => result.current.replaceMain(next))
  await waitFor(() => expect(result.current.main).toEqual(next))
  await act(async () => pending.resolve({ ...applied, providers: [originalProvider] }))
  await waitFor(() => expect(result.current.providers).toEqual([originalProvider]))
  expect(result.current.main).toEqual(next)

  api.options.mockResolvedValue({ provider: '', model: '', providers: [] })
  await act(async () => result.current.refresh())
  await waitFor(() => expect(result.current.main).toEqual({ provider: '', model: '' }))
})

it('rejects older metadata after another observer applies a default for the same owner', async () => {
  const { mount } = setup()
  const first = mount()
  const sibling = mount()
  await waitFor(() => expect(first.result.current.main).toEqual(applied))
  const metadataRevision = first.result.current.readMainRevision()
  const next = { provider: 'official-provider', model: 'new-default' }

  act(() => sibling.result.current.replaceMain(next))
  act(() => first.result.current.replaceMain(applied, metadataRevision))

  await waitFor(() => expect(first.result.current.main).toEqual(next))
  expect(sibling.result.current.main).toEqual(next)
  expect(first.result.current.readMainRevision()).toBe(metadataRevision + 1)
})

it('isolates gateway and profile assignments while retaining each owner cache', async () => {
  const pendingB = deferred<ModelOptionsResult>()
  api.options.mockImplementation((_options: unknown, owner: { connectionId: string; profile: string }) => {
    if (owner.connectionId === 'gateway-b') {
      return pendingB.promise
    }

    return Promise.resolve({
      provider: 'custom:relay',
      model: `${owner.connectionId}-${owner.profile}`,
      providers: []
    })
  })
  const { mount } = setup()
  const { result } = mount()
  await waitFor(() => expect(result.current.main?.model).toBe('gateway-a-work'))

  act(() => setApiRequestConnection('gateway-b'))
  expect(result.current.main).toBeNull()
  await act(async () => pendingB.resolve({ provider: 'custom:relay', model: 'gateway-b-work', providers: [] }))
  await waitFor(() => expect(result.current.main?.model).toBe('gateway-b-work'))
  act(() => setApiRequestConnection('gateway-a'))
  expect(result.current.main?.model).toBe('gateway-a-work')

  const otherProfile = mount('personal')
  expect(otherProfile.result.current.main).toBeNull()
  await waitFor(() => expect(otherProfile.result.current.main?.model).toBe('gateway-a-personal'))
  expect(result.current.main?.model).toBe('gateway-a-work')
})
