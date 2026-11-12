import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { createClientSessionState } from '@/lib/chat-runtime'
import { queryClient } from '@/lib/query-client'
import { confirm } from '@/store/confirm'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog } from '@/store/platform-models'
import { $activeSessionId, $currentModel, $currentProvider, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, publishSessionState } from '@/store/session-states'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { SessionModelRecovery } from './session-model-recovery'

const io = vi.hoisted(() => ({
  wire: vi.fn(),
  oldSelect: vi.fn(),
  row: vi.fn(),
  picker: null as null | { onSelect: (selection: { provider: string; model: string }) => Promise<boolean> }
}))

vi.mock('@/api/sessions', async original => ({ ...(await original<object>()), getSession: io.row }))

const route = { connectionId: 'source-a', profile: 'bot-alias', targetProfile: 'bot' }
vi.mock('@/components/model-picker', () => ({
  ModelPickerDialog: (props: typeof io.picker) => {
    io.picker = props

    return <div role="dialog" />
  }
}))
vi.mock('@/store/confirm', () => ({ confirm: vi.fn() }))
vi.mock('@/store/session-states', async original => ({
  ...(await original<object>()),
  knownOwnerForSession: () => route,
  requestForOwnedSession: (_id: string, _ambient: unknown, method: string, params: Record<string, unknown>) =>
    io.wire(method, params),
  sessionTileDelegate: () => ({
    switchSessionModel: io.oldSelect,
    updateSession: (
      id: string,
      update: (state: ReturnType<typeof $sessionStates.get>[string]) => ReturnType<typeof $sessionStates.get>[string]
    ) => {
      publishSessionState(id, update($sessionStates.get()[id]))
    }
  })
}))

const account = platformSnapshot()
const owner = { user_id: account.account!.id, platform_origin: 'https://aino.test' }
const originalDesktop = window.hermesDesktop
let backend: Record<string, unknown>
let bind: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()
  localStorage.clear()
  queryClient.clear()
  backend = { model: '', provider: '' }
  io.row.mockResolvedValue({
    id: 'bot-stored',
    profile: 'bot',
    title: 'Bot Chat',
    hidden: true,
    message_count: 0,
    model_config: { model_source: 'aino', model_id: 'catalog-a', provider: 'aino' }
  })
  bind = vi.fn(async () => {
    backend.model_status = 'ready'

    return { ok: true, ready: true }
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
        list: async () => [{ ...platformModel(), is_default: false }],
        owner: async () => owner,
        bind,
        clear: vi.fn()
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().refresh()
  recordGatewayReadyCapability(
    { connectionId: route.connectionId, profile: route.profile },
    {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1 }
    }
  )
  $activeSessionId.set('bot-runtime')
  $selectedStoredSessionId.set('bot-stored')
  $currentModel.set('')
  $currentProvider.set('')
  $sessionStates.set({ 'bot-runtime': createClientSessionState('bot-stored') })
  io.wire.mockImplementation(async (method, params) => {
    if (method === 'config.set') {
      backend =
        params.model_source === 'aino'
          ? {
              model: 'wire-model',
              provider: 'aino',
              model_id: params.value,
              model_source: 'aino',
              model_status: 'awaiting_managed_credentials',
              platform_owner: owner
            }
          : { model: params.value, provider: 'custom' }

      return {}
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'fixture-ticket' }
    }

    if (method === 'model.options') {
      return { providers: [], session_info: { ...backend } }
    }

    throw new Error(`Unexpected ${method}`)
  })
})

afterEach(() => {
  cleanup()
  clearGatewayManagedCapabilities()
  queryClient.clear()
  $sessionStates.set({})
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
})

function openRecovery() {
  render(
    <SessionViewProvider value={{ ...PRIMARY_SESSION_VIEW, $runtimeId: atom<string | null>('bot-runtime') }}>
      <SessionModelRecovery className="" label="Choose model" />
    </SessionViewProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }))
}

it('applies a zero-default account model through the standard managed binding on the captured Bot owner', async () => {
  openRecovery()
  let accepted = false
  await act(async () => {
    accepted = await io.picker!.onSelect({ provider: 'aino', model: 'catalog-a' })
  })
  expect(accepted).toBe(true)
  expect(io.wire).toHaveBeenCalledWith(
    'config.set',
    expect.objectContaining({
      session_id: 'bot-runtime',
      value: 'catalog-a',
      model_source: 'aino'
    })
  )
  expect(bind).toHaveBeenCalledWith(
    expect.objectContaining({
      connection_id: route.connectionId,
      profile: route.profile,
      session_id: 'bot-runtime',
      model_id: 'catalog-a'
    })
  )
  expect($sessionStates.get()['bot-runtime']).toMatchObject({
    model: 'catalog-a',
    provider: 'aino',
    platformModel: { status: 'ready' }
  })
  expect(io.oldSelect).not.toHaveBeenCalled()
})

it('resolves only captured model failures after a confirmed replacement is bound', async () => {
  const failure = {
    id: 'failed-model',
    role: 'assistant' as const,
    parts: [],
    error: 'Model unavailable',
    errorSurface: { layer: 'provider' as const, code: 'managed_model_access_denied', retryable: false }
  }

  publishSessionState('bot-runtime', { ...createClientSessionState('bot-stored'), messages: [failure] })
  openRecovery()
  await act(async () => {
    expect(await io.picker!.onSelect({ provider: 'aino', model: 'catalog-a' })).toBe(true)
  })
  expect($sessionStates.get()['bot-runtime'].messages[0]).toMatchObject({
    error: failure.error,
    errorResolved: 'model_changed'
  })
})

it('keeps the failure active when model binding is rejected', async () => {
  const failure = {
    id: 'failed-model',
    role: 'assistant' as const,
    parts: [],
    error: 'Model unavailable',
    errorSurface: { layer: 'provider' as const, code: 'managed_model_access_denied', retryable: false }
  }

  publishSessionState('bot-runtime', { ...createClientSessionState('bot-stored'), messages: [failure] })
  bind.mockResolvedValue({ ok: false, error: { code: 'gateway_binding_failed' } } as never)
  openRecovery()
  await act(async () => {
    expect(await io.picker!.onSelect({ provider: 'aino', model: 'catalog-a' })).toBe(false)
  })
  expect($sessionStates.get()['bot-runtime'].messages[0]).toEqual(failure)
})

it.each(['cancelled', 'deferred'])('keeps the failure active for a %s provider selection', async kind => {
  const failure = {
    id: 'failed-model',
    role: 'assistant' as const,
    parts: [],
    error: 'Model unavailable',
    errorSurface: { layer: 'provider' as const, code: 'model_not_found', retryable: false }
  }

  publishSessionState('bot-runtime', { ...createClientSessionState('bot-stored'), messages: [failure] })
  vi.mocked(confirm).mockResolvedValue(false)
  io.wire.mockResolvedValue(kind === 'cancelled' ? { confirm_required: true } : { deferred: true })
  openRecovery()
  await act(async () => {
    await io.picker!.onSelect({ provider: 'custom', model: 'new-model' })
  })
  expect($sessionStates.get()['bot-runtime'].messages[0]).toEqual(failure)
})

it.each(['catalog-a', 'catalog-b'])(
  'authorizes an exact never-used stage with the chosen available model %s',
  async modelId => {
    window.hermesDesktop.platformModels.list = async () => [platformModel(), platformModel('catalog-b')]
    await platformModelCatalog().refresh()
    publishSessionState('bot-runtime', {
      ...createClientSessionState('bot-stored'),
      model: 'catalog-a',
      provider: 'aino',
      platformModel: { modelId: 'catalog-a', ownerUserId: '', status: 'awaiting_managed_credentials' }
    })
    openRecovery()
    expect(bind).not.toHaveBeenCalled()
    let accepted = false
    await act(async () => {
      accepted = await io.picker!.onSelect({ provider: 'aino', model: modelId })
    })
    expect(accepted).toBe(true)
    expect(io.row).toHaveBeenCalledWith('bot-stored', { connectionId: 'source-a', profile: 'bot' })
    expect(bind).toHaveBeenCalledOnce()
    expect($sessionStates.get()['bot-runtime'].platformModel).toMatchObject({
      ownerUserId: owner.user_id,
      platformOrigin: owner.platform_origin,
      status: 'ready'
    })
  }
)

it('also authorizes an empty staged ordinary chat without depending on its title or visibility', async () => {
  io.row.mockResolvedValue({
    id: 'bot-stored',
    profile: 'bot',
    title: 'Untitled',
    hidden: false,
    message_count: 0,
    model_config: { model_source: 'aino', model_id: 'catalog-a', provider: 'aino' }
  })
  publishSessionState('bot-runtime', {
    ...createClientSessionState('bot-stored'),
    model: 'catalog-a',
    provider: 'aino',
    platformModel: { modelId: 'catalog-a', ownerUserId: '', status: 'awaiting_managed_credentials' }
  })
  openRecovery()
  let accepted = false
  await act(async () => {
    accepted = await io.picker!.onSelect({ provider: 'aino', model: 'catalog-a' })
  })
  expect(accepted).toBe(true)
  expect(bind).toHaveBeenCalledOnce()
})

it('keeps an unbound stage unauthorized if native binding fails', async () => {
  publishSessionState('bot-runtime', {
    ...createClientSessionState('bot-stored'),
    model: 'catalog-a',
    provider: 'aino',
    platformModel: { modelId: 'catalog-a', ownerUserId: '', status: 'awaiting_managed_credentials' }
  })
  bind.mockResolvedValue({ ok: false, error: { code: 'gateway_binding_failed' } } as never)
  openRecovery()
  let accepted = true
  await act(async () => {
    accepted = await io.picker!.onSelect({ provider: 'aino', model: 'catalog-a' })
  })
  expect(accepted).toBe(false)
  expect($sessionStates.get()['bot-runtime'].platformModel).toMatchObject({
    ownerUserId: '',
    status: 'awaiting_managed_credentials'
  })
})

it.each([
  { message_count: 1 },
  { parent_session_id: 'historical-parent' },
  { profile: 'other-bot' },
  { archived: true },
  {
    model_config: {
      model_source: 'aino',
      model_id: 'catalog-a',
      provider: 'aino',
      platform_owner: { user_id: 'other-account', platform_origin: owner.platform_origin }
    }
  },
  { model_config: { model_source: 'aino', model_id: 'catalog-a', provider: 'custom' } },
  { model_config: { model_source: 'aino', model_id: 'catalog-a', yolo_mode: 'enabled' } },
  { model_config: { model_source: 'aino', model_id: 'catalog-a', api_key: 'unrelated-pin' } }
])('rejects unbound recovery for historical or already-owned metadata: %j', async patch => {
  publishSessionState('bot-runtime', {
    ...createClientSessionState('bot-stored'),
    model: 'catalog-a',
    provider: 'aino',
    platformModel: { modelId: 'catalog-a', ownerUserId: '', status: 'awaiting_managed_credentials' }
  })
  io.row.mockResolvedValue({
    id: 'bot-stored',
    profile: 'bot',
    title: 'Bot Chat',
    hidden: true,
    message_count: 0,
    model_config: { model_source: 'aino', model_id: 'catalog-a', provider: 'aino' },
    ...patch
  })
  openRecovery()
  let accepted = true
  await act(async () => {
    accepted = await io.picker!.onSelect({ provider: 'aino', model: 'catalog-a' })
  })
  expect(accepted).toBe(false)
  expect(bind).not.toHaveBeenCalled()
  expect(io.wire).not.toHaveBeenCalled()
})

it('keeps primary BYOK recovery session-only and waits for the existing confirmation', async () => {
  openRecovery()
  const answer = deferred<boolean>()
  vi.mocked(confirm).mockReturnValueOnce(answer.promise)
  io.wire.mockImplementation(async (method, params) => {
    if (method === 'config.set') {
      return params.confirm_expensive_model ? {} : { confirm_required: true, confirm_message: 'Model price changed' }
    }

    throw new Error(`Unexpected ${method}`)
  })
  let settled = false

  const pending = io.picker!.onSelect({ provider: 'custom', model: 'official-model' }).then(value => {
    settled = true

    return value
  })

  await act(async () => {})
  expect(settled).toBe(false)
  expect(io.wire).toHaveBeenCalledWith('config.set', {
    session_id: 'bot-runtime',
    key: 'model',
    value: 'official-model --provider custom --session'
  })
  await act(async () => answer.resolve(true))
  expect(await pending).toBe(true)
  expect(io.wire).toHaveBeenLastCalledWith('config.set', expect.objectContaining({ confirm_expensive_model: true }))
  expect(bind).not.toHaveBeenCalled()
})
