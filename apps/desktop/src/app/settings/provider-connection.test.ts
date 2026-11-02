import type { ModelOptionProvider } from '@hermes/shared'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { deferred } from '@/test/deferred'

import { connectProviderApiKey } from './provider-connection'

const api = vi.hoisted(() => ({
  validate: vi.fn(),
  saveKey: vi.fn(),
  options: vi.fn(),
  recommend: vi.fn(),
  assign: vi.fn()
}))

vi.mock('@/hermes', () => ({
  validateProviderCredential: (...args: unknown[]) => api.validate(...args),
  setEnvVar: (...args: unknown[]) => api.saveKey(...args),
  getGlobalModelOptions: (...args: unknown[]) => api.options(...args),
  getRecommendedDefaultModel: (...args: unknown[]) => api.recommend(...args),
  setModelAssignment: (...args: unknown[]) => api.assign(...args)
}))

const provider: ModelOptionProvider = {
  slug: 'fixture-official',
  name: 'Fixture official',
  models: [],
  authenticated: false,
  auth_type: 'api_key',
  key_env: 'FIXTURE_OFFICIAL_API_KEY'
}

const owner = { connectionId: 'remote-writer', profile: 'writer' }
const connected = { ...provider, authenticated: true, models: ['first-model', 'recommended-model'] }

beforeEach(() => {
  vi.resetAllMocks()
  api.validate.mockResolvedValue({ ok: true, reachable: true, message: '' })
  api.saveKey.mockResolvedValue({ ok: true })
  api.options.mockResolvedValue({ providers: [connected] })
  api.recommend.mockResolvedValue({ provider: provider.slug, model: 'recommended-model' })
})

afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
})

it('validates before saving and keeps every request pinned to the original owner', async () => {
  const validation = deferred<{ ok: boolean; reachable: boolean; message: string }>()
  api.validate.mockReturnValue(validation.promise)
  const result = connectProviderApiKey(provider, '  fixture-key  ', owner)

  expect(api.validate).toHaveBeenCalledWith('FIXTURE_OFFICIAL_API_KEY', 'fixture-key', undefined, owner)
  expect(api.saveKey).not.toHaveBeenCalled()
  expect(api.options).not.toHaveBeenCalled()
  setApiRequestConnection('unrelated-host')
  setApiRequestProfile('unrelated-profile')
  validation.resolve({ ok: true, reachable: true, message: '' })

  await expect(result).resolves.toEqual({ providers: [connected], recommendedModel: 'recommended-model' })
  expect(api.saveKey).toHaveBeenCalledWith('FIXTURE_OFFICIAL_API_KEY', 'fixture-key', owner, {
    providerSetup: true
  })
  expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, owner)
  expect(api.recommend).toHaveBeenCalledWith(provider.slug, owner)
  expect(api.assign).not.toHaveBeenCalled()
})

it('does not save or discover models when the provider rejects the new key', async () => {
  api.validate.mockResolvedValue({ ok: false, reachable: true, message: 'The provider rejected this key.' })

  await expect(connectProviderApiKey(provider, 'bad-key', owner)).rejects.toThrow('The provider rejected this key.')
  expect(api.saveKey).not.toHaveBeenCalled()
  expect(api.options).not.toHaveBeenCalled()
  expect(api.recommend).not.toHaveBeenCalled()
  expect(api.assign).not.toHaveBeenCalled()
})

it.each(['unavailable', 'not-in-the-catalog'])(
  'falls back to an actual returned model when the recommendation is %s',
  async recommendation => {
    if (recommendation === 'unavailable') {
      api.recommend.mockRejectedValue(new Error('Recommendation service unavailable'))
    } else {
      api.recommend.mockResolvedValue({ provider: provider.slug, model: 'unavailable-model' })
    }

    await expect(connectProviderApiKey(provider, 'fixture-key', owner)).resolves.toEqual({
      providers: [connected],
      recommendedModel: 'first-model'
    })
    expect(api.assign).not.toHaveBeenCalled()
  }
)

it('refreshes an already saved credential without rewriting or revealing the key', async () => {
  await expect(connectProviderApiKey(connected, '', owner)).resolves.toMatchObject({
    recommendedModel: 'recommended-model'
  })

  expect(api.validate).not.toHaveBeenCalled()
  expect(api.saveKey).not.toHaveBeenCalled()
  expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, owner)
  expect(api.assign).not.toHaveBeenCalled()
})

it('uses only the official catalog row when a saved custom connection has the same name', async () => {
  api.options.mockResolvedValue({
    providers: [{ ...connected, is_user_defined: true, source: 'user-config', models: ['private-model'] }, connected]
  })

  await expect(connectProviderApiKey(provider, 'fixture-key', owner)).resolves.toMatchObject({
    recommendedModel: 'recommended-model'
  })
  expect(api.assign).not.toHaveBeenCalled()
})

it('captures an ambient connection before an asynchronous credential probe', async () => {
  const validation = deferred<{ ok: boolean; reachable: boolean; message: string }>()
  api.validate.mockReturnValue(validation.promise)
  setApiRequestConnection('ambient-owner')
  setApiRequestProfile('ambient-profile')
  const result = connectProviderApiKey(provider, 'fixture-key')
  setApiRequestConnection('other-owner')
  setApiRequestProfile('other-profile')
  validation.resolve({ ok: true, reachable: true, message: '' })
  await result

  const capturedOwner = { connectionId: 'ambient-owner', profile: 'ambient-profile' }
  expect(api.validate).toHaveBeenCalledWith('FIXTURE_OFFICIAL_API_KEY', 'fixture-key', undefined, capturedOwner)
  expect(api.saveKey).toHaveBeenCalledWith('FIXTURE_OFFICIAL_API_KEY', 'fixture-key', capturedOwner, {
    providerSetup: true
  })
  expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, capturedOwner)
})

it('keeps an untagged legacy profile route after the ambient connection changes', async () => {
  const validation = deferred<{ ok: boolean; reachable: boolean; message: string }>()
  api.validate.mockReturnValue(validation.promise)
  setApiRequestConnection(null)
  setApiRequestProfile(null)

  const result = connectProviderApiKey(provider, 'fixture-key', 'legacy-remote-profile')
  const capturedOwner = { connectionId: null, profile: 'legacy-remote-profile' }

  expect(api.validate).toHaveBeenCalledWith('FIXTURE_OFFICIAL_API_KEY', 'fixture-key', undefined, capturedOwner)
  setApiRequestConnection('new-registry-primary')
  setApiRequestProfile('new-profile')
  validation.resolve({ ok: true, reachable: true, message: '' })
  await result

  expect(api.saveKey).toHaveBeenCalledWith('FIXTURE_OFFICIAL_API_KEY', 'fixture-key', capturedOwner, {
    providerSetup: true
  })
  expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, capturedOwner)
  expect(api.recommend).toHaveBeenCalledWith(provider.slug, capturedOwner)
})

it('preserves an explicit local connection without inventing a named profile', async () => {
  await connectProviderApiKey(connected, '', { connectionId: 'local', profile: null })

  expect(api.options).toHaveBeenCalledWith(
    { refresh: true, includeUnconfigured: true },
    { connectionId: 'local', profile: null }
  )
})
