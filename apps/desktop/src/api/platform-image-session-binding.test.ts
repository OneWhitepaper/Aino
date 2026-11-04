import { afterEach, expect, it, vi } from 'vitest'

import { notify } from '@/store/notifications'
import { platformModelCatalog } from '@/store/platform-models'
import { $sessionStates } from '@/store/session-states'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { getHermesConfigRecord } from './config'
import { platformAccountActions } from './platform'
import { preparePlatformSessionRequest } from './platform-session-binding'

vi.mock('./config', () => ({ getHermesConfigRecord: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn() }))

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
  $sessionStates.set({})
  vi.clearAllMocks()
})

async function install() {
  const account = platformSnapshot()

  const image = {
    ...platformModel('image-catalog'),
    purpose: 'image' as const,
    api_mode: 'images_generations' as const,
    capabilities: { ...platformModel().capabilities, image_generation: true }
  }

  const bind = vi.fn().mockResolvedValue({ ok: true, ready: true })

  const desktop = {
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
    platformModels: {
      list: async () => [image],
      owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }),
      bind,
      clear: vi.fn()
    }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()

  return bind
}

it('binds the configured image model for a BYOK chat using the exact owning profile and session', async () => {
  const bind = await install()
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'aino', model: 'image-catalog' } })
  const request = vi.fn().mockResolvedValue({ managed_image_binding: 1, session_ticket: 'ticket' })
  const owner = { connectionId: 'remote', profile: 'gateway', targetProfile: 'writer' }

  await preparePlatformSessionRequest(owner, 'prompt.submit', { session_id: 'byok-runtime' }, request)

  expect(getHermesConfigRecord).toHaveBeenCalledWith(
    expect.objectContaining({ connectionId: 'remote', profile: 'writer' }),
    { includeDefaults: false }
  )
  expect(bind).toHaveBeenCalledWith(
    expect.objectContaining({
      connection_id: 'remote',
      profile: 'gateway',
      session_id: 'byok-runtime',
      model_id: 'image-catalog',
      purpose: 'image'
    })
  )
  expect(request).toHaveBeenCalledWith(
    'session.managed_model_ticket',
    expect.objectContaining({ purpose: 'image', session_id: 'byok-runtime' }),
    10_000
  )
})

it('keeps normal chat available when image binding fails and skips non-Aino image providers', async () => {
  const bind = await install()
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'aino', model: 'image-catalog' } })
  bind.mockResolvedValue({ ok: false, error: { code: 'not_authenticated' } })
  const request = vi.fn().mockResolvedValue({ managed_image_binding: 1, session_ticket: 'ticket' })

  await expect(
    preparePlatformSessionRequest('writer', 'prompt.submit', { session_id: 'runtime' }, request)
  ).resolves.toBeUndefined()
  expect(bind).toHaveBeenCalledOnce()
  bind.mockClear()
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'fal', model: 'existing' } })
  await preparePlatformSessionRequest('writer', 'prompt.submit', { session_id: 'runtime' }, request)
  expect(bind).not.toHaveBeenCalled()
})

it.each([{ disabled: ['image_gen'] }, { disabled: 'image_gen' }])(
  'skips image authorization when the owning profile explicitly disables image generation ($disabled)',
  async ({ disabled }) => {
    const bind = await install()
    vi.mocked(getHermesConfigRecord).mockResolvedValue({
      image_gen: { provider: 'aino', model: 'image-catalog' },
      agent: { disabled_toolsets: disabled }
    })
    const request = vi.fn()

    await preparePlatformSessionRequest('writer', 'prompt.submit', { session_id: 'text-only' }, request)

    expect(bind).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  }
)
