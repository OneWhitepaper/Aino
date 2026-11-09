import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { modelOptionsQueryKey } from '@/lib/model-options'
import { queryClient } from '@/lib/query-client'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog, readPlatformDefault, writePlatformDefault } from '@/store/platform-models'
import { $activeSessionId, $currentModel, $currentProvider, $selectedStoredSessionId } from '@/store/session'
import {
  $sessionStates,
  $sessionTiles,
  publishSessionState,
  type SessionTileDelegate,
  setSessionTileDelegate
} from '@/store/session-states'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { restoreEmptyBotModelDefault } from './plugin-empty-bot-model'

const io = vi.hoisted(() => ({ row: vi.fn(), globalModel: vi.fn(), retain: vi.fn(), release: vi.fn(), rpc: vi.fn() }))
vi.mock('@/api/sessions', async original => ({ ...(await original<object>()), getSession: io.row }))
vi.mock('@/hermes', async original => ({ ...(await original<object>()), getGlobalModelInfo: io.globalModel }))
vi.mock('@/store/gateway', async original => ({
  ...(await original<object>()),
  retainGatewayForAgent: io.retain,
  requestGatewayForAgent: io.rpc
}))

const route = { connectionId: 'local', profile: 'bot', targetProfile: 'bot', mode: 'local' as const }
const account = platformSnapshot()
const owner = { user_id: account.account!.id, platform_origin: 'http://127.0.0.1:7001' }
const storedId = 'stored-bot'
const runtimeId = 'runtime-bot'
const originalDesktop = window.hermesDesktop
let backend: Record<string, unknown>
let bind: ReturnType<typeof vi.fn>
let isCurrent: ReturnType<typeof vi.fn<() => boolean>>

const row = () => ({
  id: storedId,
  profile: 'bot',
  title: 'Bot Chat',
  hidden: 1,
  message_count: 0,
  model: '',
  model_config: null
})

const run = () => restoreEmptyBotModelDefault({ storedSessionId: storedId, route, isCurrent })

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  queryClient.clear()
  clearGatewayManagedCapabilities()
  isCurrent = vi.fn(() => true)
  $activeSessionId.set('ordinary-runtime')
  $selectedStoredSessionId.set('ordinary-stored')
  $currentModel.set('ordinary-model')
  $currentProvider.set('ordinary-provider')
  $sessionTiles.set([{ storedSessionId: storedId, runtimeId, ownerRoute: route }] as never)
  $sessionStates.set({
    [runtimeId]: {
      storedSessionId: storedId,
      messages: [],
      model: '',
      provider: '',
      platformModel: null,
      busy: false,
      awaitingResponse: false,
      turnLive: false,
      reasoningEffort: ''
    }
  } as never)
  setSessionTileDelegate({
    updateSession: (id: string, update: Parameters<SessionTileDelegate['updateSession']>[1]) => {
      const next = update($sessionStates.get()[id])
      publishSessionState(id, next)

      return next
    }
  } as never)
  backend = { model: '', provider: '' }
  io.row.mockImplementation(async () => row())
  io.globalModel.mockResolvedValue({ model: '', provider: '' })
  io.retain.mockResolvedValue(io.release)
  bind = vi.fn(async () => {
    backend.model_status = 'ready'

    return { ok: true }
  })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      accountAdapter: 'platform',
      platformAccount: {
        status: async () => account,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: {
        list: async () => [platformModel()],
        owner: async () => owner,
        bind,
        clear: vi.fn()
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  writePlatformDefault(account.account!.id, 'catalog-a', route, account.mode, owner.platform_origin)
  recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  io.rpc.mockImplementation(async (_connection, _profile, method, params) => {
    if (method === 'model.options') {
      return { providers: [], session_info: { ...backend } }
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'fixture' }
    }

    if (method === 'config.set' && params.model_source === 'aino') {
      backend = {
        provider: 'aino',
        model_source: 'aino',
        model_id: params.value,
        model_status: 'awaiting_managed_credentials',
        platform_owner: owner
      }

      return {}
    }

    throw new Error(`Unexpected RPC: ${method}`)
  })
})

afterEach(() => {
  queryClient.clear()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
  $sessionTiles.set([])
  $sessionStates.set({})
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  clearGatewayManagedCapabilities()
})

it('binds the existing empty canonical to its own saved default without a prompt, new session, or global change', async () => {
  expect(await run()).toBe(true)
  expect(io.row).toHaveBeenCalledWith(storedId, expect.objectContaining({ connectionId: 'local', profile: 'bot' }))
  expect(io.rpc.mock.calls.map(call => call[2])).toEqual([
    'model.options',
    'config.set',
    'session.managed_model_ticket',
    'model.options'
  ])
  expect(io.rpc.mock.calls.find(call => call[2] === 'config.set')?.[3]).toEqual({
    session_id: runtimeId,
    key: 'model',
    value: 'catalog-a',
    model_source: 'aino',
    confirm_expensive_model: true
  })
  expect(bind).toHaveBeenCalledWith(
    expect.objectContaining({
      connection_id: 'local',
      profile: 'bot',
      session_id: runtimeId,
      model_id: 'catalog-a'
    })
  )
  expect($sessionStates.get()[runtimeId]).toMatchObject({
    storedSessionId: storedId,
    model: 'catalog-a',
    provider: 'aino',
    messages: [],
    platformModel: { status: 'ready' }
  })
  expect(queryClient.getQueryData(modelOptionsQueryKey('bot', runtimeId, 'local'))).toMatchObject({
    model: 'catalog-a',
    provider: 'aino'
  })
  expect([$currentModel.get(), $currentProvider.get()]).toEqual(['ordinary-model', 'ordinary-provider'])
  expect(io.release).toHaveBeenCalledOnce()
  expect(await run()).toBe(false)
  expect(bind).toHaveBeenCalledOnce()
})

it.each([
  { messages: [{ id: 'message' }] },
  { busy: true },
  { awaitingResponse: true },
  { turnLive: true },
  { model: 'selected-model' },
  { provider: 'custom' },
  { platformModel: { modelId: 'selected-model' } },
  { storedSessionId: 'another-chat' }
])('preserves an existing or busy runtime: %j', async patch => {
  $sessionStates.set({ [runtimeId]: { ...$sessionStates.get()[runtimeId], ...patch } } as never)
  expect(await run()).toBe(false)
  expect(io.row).not.toHaveBeenCalled()
  expect(io.rpc).not.toHaveBeenCalled()
  expect(bind).not.toHaveBeenCalled()
})

it.each([
  { title: 'Ordinary chat' },
  { hidden: false },
  { message_count: 1 },
  { message_count: undefined },
  { profile: 'default' },
  { model: 'saved-model' },
  { model: undefined },
  { id: 'another-chat' },
  { model_config: undefined },
  { model_config: '{broken' },
  { model_config: { composer_override_profile: { model: '', provider: '' } } },
  { model_config: { model_source: 'aino', model_id: 'saved-model' } },
  { model_config: { reasoning_config: { effort: 'high' } } },
  { parent_session_id: 'historical-parent' }
])('does not treat an unproven or configured stored row as empty: %j', async patch => {
  io.row.mockResolvedValue({ ...row(), ...patch })
  expect(await run()).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
  expect(bind).not.toHaveBeenCalled()
})

it('accepts the empty canonical follow-profile marker without changing approval settings', async () => {
  io.row.mockResolvedValue({
    ...row(),
    model_config: JSON.stringify({ follow_profile_config: true, yolo_mode: false })
  })
  expect(await run()).toBe(true)
  expect(io.rpc.mock.calls.filter(call => call[2] === 'config.set').map(call => call[3].key)).toEqual(['model'])
})

it('does not borrow the API default or the ordinary workspace default when the Bot has none', async () => {
  writePlatformDefault(account.account!.id, null, route, account.mode, owner.platform_origin)
  writePlatformDefault(
    account.account!.id,
    'catalog-a',
    { ...route, profile: 'default' },
    account.mode,
    owner.platform_origin
  )
  expect(await run()).toBe(false)
  expect(io.row).not.toHaveBeenCalled()
  expect(bind).not.toHaveBeenCalled()
  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()
})

it.each(['manual-pick', 'navigated', 'runtime-rebound', 'default-changed', 'account-changed'] as const)(
  'abandons restoration when %s occurs during the stored read',
  async change => {
    const pendingRow = deferred<ReturnType<typeof row>>()
    io.row.mockReturnValue(pendingRow.promise)
    const pending = run()
    await vi.waitFor(() => expect(io.row).toHaveBeenCalledOnce())

    if (change === 'manual-pick') {
      publishSessionState(runtimeId, { ...$sessionStates.get()[runtimeId], model: 'manual' })
    }

    if (change === 'navigated') {
      isCurrent.mockReturnValue(false)
    }

    if (change === 'runtime-rebound') {
      $sessionTiles.set([{ storedSessionId: storedId, runtimeId: 'new-runtime', ownerRoute: route }] as never)
    }

    if (change === 'default-changed') {
      writePlatformDefault(account.account!.id, 'catalog-b', route, account.mode, owner.platform_origin)
    }

    if (change === 'account-changed') {
      window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-b', 2)
      await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
    }

    pendingRow.resolve(row())
    expect(await pending).toBe(false)
    expect(io.rpc).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
  }
)

it('does not overwrite a model reported by the runtime before its renderer state arrives', async () => {
  backend = { provider: 'custom', model: 'runtime-choice' }
  expect(await run()).toBe(false)
  expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
})

it('does not treat a partial runtime response as a confirmed empty model', async () => {
  backend = {}
  expect(await run()).toBe(false)
  expect(bind).not.toHaveBeenCalled()
  expect(io.rpc.mock.calls.map(call => call[2])).toEqual(['model.options'])
})

it('preserves a user model pick made while the runtime verification is pending', async () => {
  const runtimeRead = deferred<unknown>()
  io.rpc.mockReturnValueOnce(runtimeRead.promise)
  const pending = run()
  await vi.waitFor(() => expect(io.rpc).toHaveBeenCalledOnce())
  publishSessionState(runtimeId, { ...$sessionStates.get()[runtimeId], model: 'manual-choice', provider: 'custom' })
  runtimeRead.resolve({ providers: [], session_info: { model: '', provider: '' } })
  expect(await pending).toBe(false)
  expect($sessionStates.get()[runtimeId].model).toBe('manual-choice')
  expect(bind).not.toHaveBeenCalled()
  expect(io.rpc.mock.calls.map(call => call[2])).toEqual(['model.options'])
})

it.each([{ connectionId: 'foreign' }, { profile: 'different-bot' }, { targetProfile: 'different-backend' }])(
  'does not touch a same-id tile belonging to another owner: %j',
  async patch => {
    $sessionTiles.set([{ storedSessionId: storedId, runtimeId, ownerRoute: { ...route, ...patch } }] as never)
    expect(await run()).toBe(false)
    expect(io.row).not.toHaveBeenCalled()
    expect(io.rpc).not.toHaveBeenCalled()
  }
)

it('does not change a running backend even before the busy event reaches the renderer', async () => {
  backend.running = true
  expect(await run()).toBe(false)
  expect(bind).not.toHaveBeenCalled()
  expect(io.rpc.mock.calls.map(call => call[2])).toEqual(['model.options'])
})

it('does not silently substitute another authorized API default for an unavailable saved Bot model', async () => {
  writePlatformDefault(account.account!.id, 'unavailable-model', route, account.mode, owner.platform_origin)
  expect(await run()).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
  expect(bind).not.toHaveBeenCalled()
})

it('keeps the exact alias socket for model binding and its backend profile for reads', async () => {
  const aliasRoute = { ...route, profile: 'bot-alias' }
  recordGatewayReadyCapability(aliasRoute, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  $sessionTiles.set([{ storedSessionId: storedId, runtimeId, ownerRoute: aliasRoute }] as never)
  expect(await restoreEmptyBotModelDefault({ storedSessionId: storedId, route: aliasRoute, isCurrent })).toBe(true)
  expect(io.row).toHaveBeenCalledWith(storedId, expect.objectContaining({ connectionId: 'local', profile: 'bot' }))
  expect(io.rpc.mock.calls.every(call => call[0] === 'local' && call[1] === 'bot-alias')).toBe(true)
  expect(bind).toHaveBeenCalledWith(expect.objectContaining({ profile: 'bot-alias', model_id: 'catalog-a' }))
})
