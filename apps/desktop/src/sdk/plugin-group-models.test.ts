import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { deferred } from '@/test/deferred'
import { platformSnapshot } from '@/test/platform-model'

const io = vi.hoisted(() => ({
  account: null as unknown,
  resolve: vi.fn(),
  bind: vi.fn(),
  authority: vi.fn(),
  retain: vi.fn(),
  release: vi.fn(),
  answer: vi.fn()
}))

vi.mock('@/api/platform-models', () => ({ bindPlatformModel: io.bind }))
vi.mock('@/api/platform-conversation-models', () => ({ answerPlatformConversationModelRequest: io.answer }))
vi.mock('@/api/platform-session-binding', () => ({
  capturePlatformDraftAuthority: io.authority,
  createPlatformDraft: vi.fn()
}))
vi.mock('@/lib/model-default', () => ({ resolveModelDefault: io.resolve }))
vi.mock('@/store/gateway', () => ({
  $gateway: { get: () => null },
  retainGatewayForAgent: io.retain,
  requestGatewayForAgent: vi.fn()
}))
vi.mock('@/store/platform-models', () => ({
  platformModelCatalog: () => ({ account: { get: () => io.account } }),
  PlatformSelectionError: class extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
}))
vi.mock('./plugin-profile-create', () => ({ requestPluginProfileCreate: vi.fn() }))

import { respondPluginGroupModelRequests } from './plugin-group-models'
import { requestPluginSession } from './plugin-session-create'

const originalDesktop = window.hermesDesktop
const account = platformSnapshot()
const owner = { user_id: account.account!.id, platform_origin: 'http://127.0.0.1:7001' }
const route = { connectionId: 'source-a', profile: 'desktop-owner', targetProfile: 'room-owner' }
const localA = { member_id: 'seat-a', profile: 'bot-a', target: { kind: 'local' } }
const localB = { member_id: 'seat-b', profile: 'bot-b', target: { kind: 'local' } }

function managed(modelId = 'catalog-a') {
  return {
    model: modelId,
    provider: 'aino',
    platform: { modelId, ownerUserId: owner.user_id, platformOrigin: owner.platform_origin }
  }
}

function transport(members = [localA, localB], supported = true) {
  return vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'groups.state') {
      return { room: { members } }
    }

    if (method === 'groups.capabilities') {
      return { methods: supported ? ['groups.prepare_model', 'groups.model_respond'] : [] }
    }

    if (method === 'groups.prepare_model') {
      const seated = members.find(member => member.member_id === params.member_id)!

      if (params.inspect_selection === true) {
        return { profile: seated.profile, session_id: `group-${seated.member_id}`, selection: null }
      }

      if (params.follow_profile_config === true) {
        return { profile: seated.profile, session_id: `group-${seated.member_id}`, follow_profile_config: true }
      }

      return {
        profile: seated.profile,
        session_id: `group-${seated.member_id}`,
        model_id: params.model_id,
        managed_model_binding: 1,
        session_ticket: `private-${seated.member_id}`
      }
    }

    if (['groups.send', 'groups.retry', 'groups.approve', 'groups.stop'].includes(method)) {
      return { ok: true }
    }
    throw new Error(`Unexpected read ${method}`)
  })
}

function execute(
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  method: string,
  intent: Record<string, unknown>
) {
  return requestPluginSession(route, request as Parameters<typeof requestPluginSession>[1], method, intent)
}

beforeEach(() => {
  vi.clearAllMocks()
  io.account = account
  io.retain.mockResolvedValue(io.release)
  io.resolve.mockResolvedValue(managed())
  io.authority.mockResolvedValue({ account, owner })
  io.bind.mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { accountAdapter: 'platform' } })
})

afterEach(() => Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop }))

it('keeps explicit external providers working on a runtime without hosted managed-model support', async () => {
  io.resolve.mockResolvedValue({ model: 'external-model', provider: 'custom', platform: null })
  const request = transport([localA], false)
  const intent = { room_id: 'room-a', event_id: 'journal-a', payload: { text: 'hello' } }
  await execute(request, 'groups.send', intent)
  expect(request.mock.calls.at(-1)).toEqual(['groups.send', intent])
  expect(request).toHaveBeenCalledWith('groups.capabilities', { profile: route.targetProfile })
  expect(request.mock.calls.some(call => call[0] === 'groups.prepare_model')).toBe(false)
  expect(io.authority).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
})

it('returns an existing managed room member to its own external profile without capturing this account or binding another key', async () => {
  io.resolve.mockResolvedValue({ model: 'external-model', provider: 'custom', platform: null })
  const request = transport([localA])
  const intent = { room_id: 'room-a', event_id: 'same-journal', payload: { text: 'use the configured provider' } }
  await execute(request, 'groups.send', intent)
  expect(request).toHaveBeenCalledWith(
    'groups.prepare_model',
    {
      profile: route.targetProfile,
      room_id: 'room-a',
      member_id: localA.member_id,
      follow_profile_config: true
    },
    10_000
  )
  expect(io.authority).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(request.mock.calls.at(-1)).toEqual(['groups.send', intent])
  expect(request.mock.calls.at(-1)?.[1]).toBe(intent)
})

it('refuses a managed send on an older runtime before spending or submitting its journaled event', async () => {
  const request = transport([localA], false)
  await expect(execute(request, 'groups.send', { room_id: 'room-a', event_id: 'journal-a' })).rejects.toMatchObject({
    code: 'unsupported_gateway'
  })
  expect(request.mock.calls.some(call => call[0] === 'groups.prepare_model' || call[0] === 'groups.send')).toBe(false)
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
})

it('never borrows this account for a peer member even when its profile name matches a local profile', async () => {
  const request = transport([{ ...localA, target: { kind: 'peer' } }])
  await execute(request, 'groups.send', { room_id: 'room-a', event_id: 'journal-a' })
  expect(io.resolve).not.toHaveBeenCalled()
  expect(io.authority).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(request.mock.calls.at(-1)?.[0]).toBe('groups.send')
})

it('rejects account turnover after the member prepare RPC without binding or sending the prior account event', async () => {
  const prepared = deferred<void>()
  const gate = deferred<void>()
  const base = transport([localA])

  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'groups.prepare_model') {
      prepared.resolve()
      await gate.promise
    }

    return base(method, params)
  })

  const pending = execute(request, 'groups.send', { room_id: 'room-a', event_id: 'journal-a' })
  await prepared.promise
  io.account = platformSnapshot('user-b', 2)
  gate.resolve()
  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(io.bind).not.toHaveBeenCalled()
  expect(base.mock.calls.some(call => call[0] === 'groups.send')).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it.each(['groups.stop', 'groups.approve'])(
  'preserves recovery control %s without requiring unrelated model configuration',
  async method => {
    const request = transport()
    const intent = { room_id: 'room-a', choice: 'deny', member_id: 'seat-a' }
    await execute(request, method, intent)
    expect(request).toHaveBeenCalledExactlyOnceWith(method, intent)
    expect(io.resolve).not.toHaveBeenCalled()
    expect(io.retain).not.toHaveBeenCalled()
  }
)

it('approves the frozen task without resolving current defaults or changing its managed binding', async () => {
  io.resolve.mockRejectedValue(new Error('Current default was removed while approval was open'))
  const request = transport()
  const intent = {
    room_id: 'room-a',
    member_id: 'seat-a',
    task_id: 'saved-task-a',
    execution_generation: 1,
    choice: 'once'
  }
  await expect(execute(request, 'groups.approve', intent)).resolves.toEqual({ ok: true })
  expect(request).toHaveBeenCalledExactlyOnceWith('groups.approve', intent)
  expect(io.resolve).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
})

it('does not let an unrelated unavailable member block retry of the exact saved recipient', async () => {
  io.resolve.mockImplementation(async (scope: { profile: string }) => {
    if (scope.profile === 'bot-b') {
      throw new Error('Unrelated member model is unavailable')
    }

    return managed()
  })
  const request = transport()
  const intent = {
    room_id: 'room-a',
    member_id: 'seat-a',
    task_id: 'saved-task-a',
    execution_generation: 1,
    choice: 'once'
  }
  await expect(execute(request, 'groups.retry', intent)).resolves.toEqual({ ok: true })
  expect(io.resolve.mock.calls.every(call => call[0].profile !== 'bot-b')).toBe(true)
  expect(request.mock.calls.at(-1)).toEqual(['groups.retry', intent])
})

it('keeps a conversation-selected built-in model instead of overwriting it with the profile default', async () => {
  const base = transport([localA])

  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'groups.prepare_model' && params?.inspect_selection === true) {
      return {
        profile: localA.profile,
        session_id: 'group-seat-a',
        selection: {
          model_id: 'selected-deepseek',
          model_source: 'aino',
          provider: 'aino',
          owner
        }
      }
    }

    return base(method, params)
  })

  await execute(request, 'groups.send', { room_id: 'room-a', event_id: 'same-event' })
  expect(io.resolve).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledWith(
    'groups.prepare_model',
    expect.objectContaining({ model_id: 'selected-deepseek', owner }),
    10_000
  )
  expect(io.bind).toHaveBeenCalledWith(
    expect.objectContaining({ profile: localA.profile, model_id: 'selected-deepseek' }),
    account,
    expect.any(Function)
  )
})

it('answers a group model request against the exact member connection without changing its current runtime', async () => {
  io.answer.mockResolvedValue({ status: 'selected', selection: { model_id: 'deepseek', model_source: 'aino', owner } })
  const request = vi.fn(async () => ({}))
  await respondPluginGroupModelRequests(
    route,
    request as never,
    'room-a',
    [localA],
    [
      {
        request_id: 'request-a',
        session_id: 'group-seat-a',
        member_id: 'seat-a',
        profile: 'bot-a',
        action: 'select',
        query: 'deepseek'
      }
    ]
  )
  expect(io.answer).toHaveBeenCalledExactlyOnceWith(
    { connectionId: 'source-a', profile: 'bot-a' },
    { action: 'select', query: 'deepseek' }
  )
  expect(request).toHaveBeenCalledExactlyOnceWith(
    'groups.model_respond',
    {
      profile: 'room-owner',
      room_id: 'room-a',
      request_id: 'request-a',
      result: {
        status: 'selected',
        selection: { model_id: 'deepseek', model_source: 'aino', owner }
      }
    },
    10_000
  )
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.resolve).not.toHaveBeenCalled()
})

it('keeps a configured provider conversation choice usable without an Aino login', async () => {
  io.account = null
  const selected = { model_id: 'configured-deepseek', model_source: 'provider', provider: 'custom:relay' }
  io.answer.mockResolvedValue({ status: 'selected', selection: selected })
  const base = transport([localA])

  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'groups.prepare_model' && params?.inspect_selection === true) {
      return { profile: localA.profile, session_id: 'group-seat-a', selection: selected }
    }

    if (method === 'groups.prepare_model' && params?.apply_selection === true) {
      return { profile: localA.profile, session_id: 'group-seat-a', selection: selected }
    }

    return base(method, params)
  })

  await execute(request, 'groups.send', { room_id: 'room-a', event_id: 'same-event' })
  expect(request).toHaveBeenCalledWith(
    'groups.prepare_model',
    expect.objectContaining({ apply_selection: true }),
    10_000
  )
  expect(io.resolve).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
})
