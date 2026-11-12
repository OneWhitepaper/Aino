import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { textPart } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $botChatSessionIds } from '@/store/bot-chat-scope'
import { platformModelCatalog } from '@/store/platform-models'
import { $sessionStates } from '@/store/session-states'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { platformAccountActions } from './platform'
import { preparePlatformSessionRequest } from './platform-session-binding'

const originalDesktop = window.hermesDesktop
const io = vi.hoisted(() => ({ row: vi.fn(), globalModel: vi.fn() }))
vi.mock('./sessions', async original => ({ ...(await original<object>()), getSession: io.row }))
vi.mock('@/hermes', async original => ({ ...(await original<object>()), getGlobalModelInfo: io.globalModel }))

beforeEach(async () => {
  vi.clearAllMocks()
  $botChatSessionIds.set(new Set(['bot-stored']))
  io.row.mockResolvedValue({
    id: 'bot-stored',
    profile: 'bot',
    title: 'Bot Chat',
    hidden: true,
    message_count: 0,
    model: 'z-ai/glm-5.3',
    model_config: { follow_profile_config: true }
  })
  io.globalModel.mockResolvedValue({ model: '', provider: '' })
  const snapshot = platformSnapshot()
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      accountAdapter: 'platform',
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: {
        list: async () => [{ ...platformModel(), is_default: false }],
        owner: async () => ({ user_id: snapshot.account!.id, platform_origin: 'https://aino.test' }),
        bind: vi.fn(),
        clear: vi.fn()
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().refresh()
})

afterEach(() => {
  $botChatSessionIds.set(new Set())
  $sessionStates.set({})
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
})

it.each(['prompt.submit', 'session.summary'])(
  'requires a real selection before %s despite a silent fallback label',
  async method => {
    $sessionStates.set({ bot: { ...createClientSessionState('bot-stored'), model: 'z-ai/glm-5.3' } })

    const wire = vi.fn(async (requestMethod: string) => {
      if (requestMethod === 'model.session') {
        return { selection: null }
      }

      if (requestMethod === 'model.options') {
        return {
          model: 'z-ai/glm-5.3',
          provider: '',
          providers: [],
          session_info: { model: '', provider: '', running: false }
        }
      }

      throw new Error(`Unexpected dispatched request: ${requestMethod}`)
    })

    const send = async () => {
      await preparePlatformSessionRequest(
        { connectionId: 'owned', profile: 'bot' },
        method,
        { session_id: 'bot' },
        wire as never
      )
      await wire(method)
    }

    await expect(send()).rejects.toMatchObject({ code: 'model_unavailable' })
    expect(wire.mock.calls.map(([method]) => method)).toEqual(['model.session'])
    expect(window.hermesDesktop.platformModels.bind).not.toHaveBeenCalled()
  }
)

it('keeps a configured third-party conversation on its existing request path', async () => {
  io.globalModel.mockResolvedValue({ model: 'official-model', provider: 'custom' })
  $sessionStates.set({
    bot: { ...createClientSessionState('bot-stored'), model: 'official-model', provider: 'custom' }
  })
  const wire = vi.fn(async () => ({ selection: null }))

  await expect(
    preparePlatformSessionRequest('bot', 'session.summary', { session_id: 'bot' }, wire as never)
  ).resolves.toBeUndefined()
  expect(window.hermesDesktop.platformModels.bind).not.toHaveBeenCalled()
})

it('blocks the ambient provider of a never-used canonical instead of treating it as a user selection', async () => {
  $sessionStates.set({ bot: { ...createClientSessionState('bot-stored'), model: 'z-ai/glm-5.3', provider: 'nous' } })
  const wire = vi.fn(async () => ({ selection: null }))

  await expect(
    preparePlatformSessionRequest(
      { connectionId: 'owned', profile: 'bot' },
      'prompt.submit',
      { session_id: 'bot' },
      wire as never
    )
  ).rejects.toMatchObject({ code: 'model_unavailable' })
  expect(window.hermesDesktop.platformModels.bind).not.toHaveBeenCalled()
})

it('does not inspect an unpersisted ordinary BYOK draft as a Bot canonical', async () => {
  $botChatSessionIds.set(new Set())
  $sessionStates.set({
    draft: { ...createClientSessionState('unpersisted-draft'), model: 'official-model', provider: 'custom' }
  })
  const wire = vi.fn(async () => ({ selection: null }))

  await expect(
    preparePlatformSessionRequest('default', 'session.summary', { session_id: 'draft' }, wire as never)
  ).resolves.toBeUndefined()
  expect(io.row).not.toHaveBeenCalled()
  expect(io.globalModel).not.toHaveBeenCalled()
})

it('does not mistake an optimistic user message for a persisted model selection', async () => {
  $sessionStates.set({
    bot: {
      ...createClientSessionState('bot-stored'),
      model: 'z-ai/glm-5.3',
      provider: 'nous',
      messages: [{ id: 'pending-user', role: 'user', parts: [textPart('hello')], pending: true }]
    }
  })
  const wire = vi.fn(async () => ({ selection: null }))

  await expect(
    preparePlatformSessionRequest(
      { connectionId: 'owned', profile: 'bot' },
      'prompt.submit',
      { session_id: 'bot' },
      wire as never
    )
  ).rejects.toMatchObject({ code: 'model_unavailable' })
})

it('preserves an actual historical conversation with persisted messages', async () => {
  io.row.mockResolvedValue({
    id: 'bot-stored',
    profile: 'bot',
    title: 'Bot Chat',
    hidden: true,
    message_count: 2,
    model: 'historical-model',
    model_config: { follow_profile_config: true }
  })
  $sessionStates.set({
    bot: { ...createClientSessionState('bot-stored'), model: 'historical-model', provider: 'custom' }
  })
  const wire = vi.fn(async () => ({ selection: null }))

  await expect(
    preparePlatformSessionRequest(
      { connectionId: 'owned', profile: 'bot' },
      'session.summary',
      { session_id: 'bot' },
      wire as never
    )
  ).resolves.toBeUndefined()
  expect(io.globalModel).not.toHaveBeenCalled()
})
