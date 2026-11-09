import { beforeEach, expect, it, vi } from 'vitest'

import type * as PlatformModels from '@/store/platform-models'
import { platformModel } from '@/test/platform-model'

import type { PlatformModel } from '../../shared/platform-contract'

const catalog = vi.hoisted(() => {
  const account = {
    phase: 'signed_in',
    account: { id: 'user' },
    revision: 1,
    mode: 'platform',
    model_identity_ready: false
  }
  const state: { phase: string; models: PlatformModel[] } = { phase: 'ready', models: [] }

  return {
    account: { get: () => account },
    owner: { state: { get: () => ({ owner: { user_id: 'user', platform_origin: 'https://aino.test' } }) } },
    state: { get: () => state },
    load: vi.fn(),
    models: state
  }
})

vi.mock('@/hermes', () => ({ getGlobalModelInfo: vi.fn(async () => ({ model: '', provider: '' })) }))
vi.mock('@/store/gateway-managed-capability', () => ({ managedModelRouteCapability: () => 'supported' }))
vi.mock('@/lib/platform-model-scope', () => ({
  platformDefaultScope: () => ({ route: { profile: 'default' }, key: 'default' })
}))
vi.mock('@/store/platform-models', async importOriginal => ({
  ...(await importOriginal<typeof PlatformModels>()),
  platformModelCatalog: () => catalog,
  readPlatformDefault: () => null
}))

import { evaluateModelDefaultReadiness } from './model-default'

beforeEach(() => {
  catalog.models.models = []
  Object.assign(catalog.account.get(), { phase: 'signed_in', model_identity_ready: false })
})

it('keeps text inference unavailable when the account only offers image generation', async () => {
  catalog.models.models = [
    {
      ...platformModel('image'),
      purpose: 'image',
      api_mode: 'images_generations',
      capabilities: { ...platformModel().capabilities, image_generation: true }
    }
  ]
  const requestGateway = vi.fn()
  const result = await evaluateModelDefaultReadiness(requestGateway, 'default')

  expect(result).toMatchObject({ ready: false, source: 'platform_model' })
  expect(result.reason).toBeTruthy()
  expect(requestGateway).not.toHaveBeenCalled()
})

it('keeps an available text model selectable even when no default has been chosen', async () => {
  catalog.models.models = [{ ...platformModel('chat'), is_default: false }]

  expect(await evaluateModelDefaultReadiness(vi.fn(), 'default')).toMatchObject({
    ready: true,
    reason: null,
    source: 'platform_model'
  })
})

it.each(['offline', 'reauth_required'])(
  'checks the retained device model catalog when account management is %s',
  async phase => {
    Object.assign(catalog.account.get(), { phase, model_identity_ready: true })
    catalog.models.models = [platformModel()]
    const requestGateway = vi.fn()

    expect(await evaluateModelDefaultReadiness(requestGateway, 'default')).toMatchObject({
      ready: true,
      model: 'catalog-a',
      source: 'platform_model'
    })
    catalog.models.models = []
    expect(await evaluateModelDefaultReadiness(requestGateway, 'default')).toMatchObject({
      ready: false,
      source: 'platform_model'
    })
    expect(requestGateway).not.toHaveBeenCalled()
  }
)
