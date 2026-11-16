import { beforeEach, expect, it, vi } from 'vitest'

import type * as PlatformModels from '@/store/platform-models'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformAccountSnapshot, PlatformModel } from '../../shared/platform-contract'

import { readProfileEffectiveModel } from './profile-effective-model'

const fixture = vi.hoisted(() => ({
  account: null as PlatformAccountSnapshot | null,
  models: [] as PlatformModel[],
  preferences: new Map<string, string>(),
  global: vi.fn(),
  load: vi.fn(async () => undefined),
  write: vi.fn(),
  owner: { user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' }
}))

vi.mock('@/hermes', () => ({ getGlobalModelInfo: fixture.global }))
vi.mock('@/store/gateway', () => ({ activeGatewayConnectionId: () => 'local' }))
vi.mock('@/store/gateway-managed-capability', () => ({ managedModelRouteCapability: () => 'supported' }))
vi.mock('@/store/platform-models', async original => ({
  ...(await original<typeof PlatformModels>()),
  platformModelCatalog: () => ({
    account: { get: () => fixture.account },
    state: { get: () => ({ phase: 'ready', models: fixture.models, error: null }) },
    owner: { state: { get: () => ({ owner: fixture.owner }) } },
    load: fixture.load
  }),
  readPlatformDefault: (_account: string, scope: { route: { connectionId?: string; profile: string } }) =>
    fixture.preferences.get(JSON.stringify([scope.route.connectionId, scope.route.profile])) ?? null,
  writePlatformDefault: fixture.write
}))

const route = { connectionId: 'local', profile: 'research', targetProfile: 'backend-local', mode: 'local' as const }

beforeEach(() => {
  vi.clearAllMocks()
  fixture.account = platformSnapshot()
  fixture.models = [{ ...platformModel('glm'), display_name: 'GLM-5.3-Flash', is_default: false }]
  fixture.preferences.clear()
  fixture.preferences.set(JSON.stringify(['local', 'backend-local']), 'glm')
  fixture.global.mockResolvedValue({ model: '', provider: '' })
})

it('reads the inherited built-in effective model even when config.yaml has an empty model assignment', async () => {
  expect(await readProfileEffectiveModel('research', route)).toEqual({
    model: 'glm',
    provider: 'aino',
    label: 'GLM-5.3-Flash'
  })
  expect(fixture.global).toHaveBeenCalledWith({ connectionId: 'local', profile: 'backend-local' })
  expect(fixture.write).not.toHaveBeenCalled()
})

it('keeps an explicit custom provider assignment ahead of a retained Aino preference', async () => {
  fixture.global.mockResolvedValue({ model: 'custom-chat', provider: 'custom:studio' })

  expect(await readProfileEffectiveModel('research', route)).toEqual({
    model: 'custom-chat',
    provider: 'custom:studio',
    label: 'custom-chat'
  })
  expect(fixture.load).not.toHaveBeenCalled()
  expect(fixture.write).not.toHaveBeenCalled()
})

it('uses the exact connection and backend profile for same-name bots on different sources', async () => {
  const remote = { ...route, connectionId: 'studio', targetProfile: 'backend-remote', mode: 'remote' as const }
  fixture.models.push({ ...platformModel('studio-model'), display_name: 'Studio model', is_default: false })
  fixture.preferences.set(JSON.stringify(['studio', 'backend-remote']), 'studio-model')

  expect((await readProfileEffectiveModel('research', route)).label).toBe('GLM-5.3-Flash')
  expect((await readProfileEffectiveModel('research', remote)).label).toBe('Studio model')
  expect(fixture.global).toHaveBeenLastCalledWith({ connectionId: 'studio', profile: 'backend-remote' })
})

it('propagates model lookup errors and refuses a mismatched owner without saving anything', async () => {
  fixture.global.mockRejectedValueOnce(new Error('Model route unavailable'))
  await expect(readProfileEffectiveModel('research', route)).rejects.toThrow('Model route unavailable')
  await expect(readProfileEffectiveModel('other', route)).rejects.toThrow('matching profile owner')
  expect(fixture.global).toHaveBeenCalledOnce()
  expect(fixture.write).not.toHaveBeenCalled()
})
