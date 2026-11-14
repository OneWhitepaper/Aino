import { afterEach, expect, it, vi } from 'vitest'

import { getHermesConfigRecord } from '@/api/config'
import { preparePlatformImageSession } from '@/api/platform-image-session-binding'
import { clearPlatformSession } from '@/api/platform-session-binding'
import { deleteSession } from '@/api/sessions'
import { platformModelCatalog } from '@/store/platform-models'
import { platformSnapshot } from '@/test/platform-model'

import { requestPluginImageGeneration } from './plugin-image-generation'

vi.mock('@/api/config', () => ({ getHermesConfigRecord: vi.fn() }))
vi.mock('@/api/platform-image-session-binding', () => ({ preparePlatformImageSession: vi.fn() }))
vi.mock('@/api/sessions', () => ({ deleteSession: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/api/platform-session-binding', () => ({ clearPlatformSession: vi.fn(async () => {}) }))
vi.mock('@/store/gateway', () => ({ retainGatewayForAgent: vi.fn(async () => vi.fn()) }))

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const route = { connectionId: 'local', profile: 'new-bot', targetProfile: 'writer' }

it('binds a temporary hidden image session on the captured route and cleans it after generation', async () => {
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'aino', model: 'image' } })
  const calls: string[] = []

  const wire = vi.fn(async (method: string) => {
    calls.push(method)

    return method === 'session.create'
      ? { session_id: 'avatar', stored_session_id: 'avatar' }
      : { success: true, image: 'picture' }
  })

  const account = platformSnapshot()
  vi.spyOn(platformModelCatalog().account, 'get').mockReturnValue(account)
  vi.mocked(preparePlatformImageSession).mockImplementationOnce(async (_owner, sid, request) => {
    await request('session.managed_model_ticket', { session_id: sid, purpose: 'image' }, 10_000)
  })
  await expect(requestPluginImageGeneration(route, wire as never, { prompt: 'robot' }, 90_000)).resolves.toMatchObject({
    success: true
  })
  expect(wire).toHaveBeenNthCalledWith(
    1,
    'session.create',
    expect.objectContaining({ hidden: true, source: 'desktop', profile: 'writer' })
  )
  expect(preparePlatformImageSession).toHaveBeenCalledWith(
    { connectionId: 'local', profile: 'new-bot', targetProfile: 'writer' },
    'avatar',
    expect.any(Function),
    true
  )
  expect(wire).toHaveBeenLastCalledWith(
    'image.generate',
    { prompt: 'robot', session_id: 'avatar', profile: 'writer' },
    90_000
  )
  expect(wire).toHaveBeenCalledWith(
    'session.managed_model_ticket',
    { session_id: 'avatar', purpose: 'image', profile: 'writer' },
    10_000
  )
  expect(deleteSession).toHaveBeenCalledWith('avatar', { connectionId: 'local', profile: 'writer' })
  expect(clearPlatformSession).toHaveBeenCalledWith(
    { connectionId: 'local', profile: 'new-bot', targetProfile: 'writer' },
    'avatar',
    'image'
  )
  expect(calls).toEqual(['session.create', 'session.managed_model_ticket', 'image.generate'])
})

it('does not start an image operation when authorization fails and still cleans its temporary session', async () => {
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'aino', model: 'image' } })
  const account = platformSnapshot()
  vi.spyOn(platformModelCatalog().account, 'get').mockReturnValue(account)
  vi.mocked(preparePlatformImageSession).mockRejectedValueOnce(new Error('not_authenticated'))
  const wire = vi.fn(async () => ({ session_id: 'temporary', stored_session_id: 'temporary' }))
  await expect(requestPluginImageGeneration(route, wire as never, { prompt: 'robot' }, 90_000)).rejects.toThrow(
    'not_authenticated'
  )
  expect(wire).toHaveBeenCalledTimes(1)
  expect(deleteSession).toHaveBeenCalledOnce()
})

it('preserves provider and probe calls without creating a managed session', async () => {
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'fal' } })
  const wire = vi.fn(async (_method: string) => ({ available: true }))
  await requestPluginImageGeneration(route, wire as never, { prompt: 'robot' }, 90_000)
  await requestPluginImageGeneration(route, wire as never, { probe: true })
  expect(wire.mock.calls.map(call => call[0])).toEqual(['image.generate', 'image.generate'])
  expect(preparePlatformImageSession).not.toHaveBeenCalled()
})

it('discards an old account image result and cleans its authority after an account switch', async () => {
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'aino', model: 'image' } })
  let account = platformSnapshot()
  vi.spyOn(platformModelCatalog().account, 'get').mockImplementation(() => account)

  const wire = vi.fn(async (method: string) => {
    if (method === 'session.create') {
      return { session_id: 'previous-account' }
    }
    account = platformSnapshot('user-b')

    return { success: true, image: 'old-account-image' }
  })

  await expect(requestPluginImageGeneration(route, wire as never, { prompt: 'robot' }, 90_000)).rejects.toMatchObject({
    code: 'platform_account_changed'
  })
  expect(clearPlatformSession).toHaveBeenCalledWith(expect.anything(), 'previous-account', 'image')
  expect(deleteSession).toHaveBeenCalledOnce()
})
