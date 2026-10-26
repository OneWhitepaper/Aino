import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { getGlobalModelInfo, getStatus } from '@/hermes'
import { setRuntimeI18nLocale } from '@/i18n'
import { resolveModelDefault } from '@/lib/model-default'
import { runtimeReadinessDisplay, type RuntimeReadinessRequester } from '@/lib/runtime-readiness'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog, readPlatformDefault } from '@/store/platform-models'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformAccountSnapshot } from '../../../../shared/platform-contract'

import { useStatusSnapshot } from './use-status-snapshot'

vi.mock('@/hermes', () => ({ getStatus: vi.fn(), getGlobalModelInfo: vi.fn() }))

const scope = { connectionId: 'local', profile: 'default' }
const noProvider = 'Hermes is not connected to any AI provider yet.'

const requestGateway: RuntimeReadinessRequester = async <T,>(method: string) => {
  const responses: Record<string, unknown> = {
    'setup.status': { provider_configured: false },
    'setup.runtime_check': { ok: false, error: noProvider },
    'free_tier.status': { available: false }
  }

  if (!(method in responses)) {
    throw new Error(`Unexpected RPC: ${method}`)
  }

  return responses[method] as T
}

function supportRoute(route = scope) {
  recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
}

function installPlatform() {
  let snapshot: PlatformAccountSnapshot = platformSnapshot()

  let changed: (next: PlatformAccountSnapshot) => void = () => {}
  const list = vi.fn(async () => [platformModel()])
  const owner = vi.fn(async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' }))

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: (listener: typeof changed) => {
          changed = listener

          return () => {}
        }
      },
      platformModels: { list, owner }
    }
  })

  return {
    list,
    owner,
    publish(next: PlatformAccountSnapshot) {
      snapshot = next
      changed(next)
    },
    load: () => platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  }
}

beforeEach(() => {
  setRuntimeI18nLocale('en')
  vi.spyOn(globalThis.document, 'hasFocus').mockReturnValue(true)
  vi.mocked(getStatus).mockResolvedValue({} as never)
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: '', provider: '' })
  supportRoute()
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  localStorage.clear()
  clearGatewayManagedCapabilities()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('recognizes a first-install Aino default without configuring a provider or issuing inference', async () => {
  const platform = installPlatform()
  await platform.load()

  const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))

  await waitFor(() =>
    expect(result.current.inferenceStatus).toMatchObject({
      ready: true,
      reason: null,
      source: 'platform_model',
      model: 'catalog-a'
    })
  )
  expect(getGlobalModelInfo).toHaveBeenCalledWith({ connectionId: 'local', profile: 'default' })
})

it.each(['no-default', 'unavailable-default'] as const)(
  'keeps selectable Aino inference ready without inventing a default: %s',
  async defaultState => {
    const platform = installPlatform()
    const selectable = { ...platformModel('selectable'), is_default: false }
    platform.list.mockResolvedValue(
      defaultState === 'no-default'
        ? [selectable]
        : [{ ...platformModel('unavailable-default'), state: 'quota_exhausted' }, selectable]
    )
    await platform.load()

    const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))

    await waitFor(() =>
      expect(result.current.inferenceStatus).toMatchObject({
        ready: true,
        reason: null,
        source: 'platform_model'
      })
    )
    expect(runtimeReadinessDisplay(result.current.inferenceStatus)).toBe('ready')
    expect(result.current.inferenceStatus?.model).toBeUndefined()

    // Health is not a model choice: the user must still pick a model before a new chat.
    await expect(resolveModelDefault(scope)).rejects.toMatchObject({ code: 'model_unavailable' })
    expect(readPlatformDefault('user-a', scope, 'development', 'http://127.0.0.1:7001')).toBeNull()
  }
)

it('refreshes on Aino login while unfocused and retires its readiness immediately on logout', async () => {
  const platform = installPlatform()
  platform.publish({ ...platformSnapshot(), phase: 'signed_out', account: null })
  await platform.load()
  const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))
  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(false))

  vi.mocked(globalThis.document.hasFocus).mockReturnValue(false)
  act(() => platform.publish(platformSnapshot('user-a', 2)))
  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(true))

  act(() => platform.publish({ ...platformSnapshot('user-a', 3), phase: 'signed_out', account: null }))
  await waitFor(() => expect(result.current.inferenceStatus?.ready).not.toBe(true))
})

it('requires managed capability evidence for this exact connection and profile', async () => {
  clearGatewayManagedCapabilities()
  supportRoute({ connectionId: 'other', profile: 'default' })
  const platform = installPlatform()
  await platform.load()

  const { result, rerender } = renderHook(({ route }) => useStatusSnapshot('open', requestGateway, route), {
    initialProps: { route: scope }
  })

  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(false))

  act(() => supportRoute())
  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(true))

  rerender({ route: { connectionId: 'local', profile: 'other-profile' } })
  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(false))
  expect(getGlobalModelInfo).toHaveBeenLastCalledWith({ connectionId: 'local', profile: 'other-profile' })
})

it.each(['insufficient_balance', 'quota_exhausted', 'unavailable'] as const)(
  'does not treat login as readiness when the built-in model is %s',
  async state => {
    const platform = installPlatform()
    platform.list.mockResolvedValue([{ ...platformModel(), state }])
    await platform.load()
    const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))

    await waitFor(() =>
      expect(result.current.inferenceStatus).toMatchObject({
        ready: false,
        source: 'platform_model'
      })
    )
    expect(runtimeReadinessDisplay(result.current.inferenceStatus)).toBe('unavailable')
    expect(result.current.inferenceStatus?.reason).not.toContain(noProvider)
  }
)

it.each(['catalog-failed', 'owner-mismatch'])(
  'does not trust a model list without current account authority: %s',
  async failure => {
    const platform = installPlatform()

    if (failure === 'catalog-failed') {
      platform.list.mockRejectedValue(new Error('offline'))
    } else {
      platform.owner.mockResolvedValue({ user_id: 'other-user', platform_origin: 'http://127.0.0.1:7001' })
    }

    await platform.load()
    const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))

    await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(false))
  }
)

it('keeps checking the configured custom default rather than masking its failure with an Aino model', async () => {
  const platform = installPlatform()
  platform.list.mockReturnValue(deferred<ReturnType<typeof platformModel>[]>().promise)
  await platform.load()
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: 'custom-model', provider: 'custom:mine' })
  const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))

  await waitFor(() =>
    expect(result.current.inferenceStatus).toMatchObject({
      ready: false,
      source: 'runtime_check',
      reason: noProvider
    })
  )
})

it('cannot restore a previous account verdict when a model-info request completes after logout', async () => {
  const platform = installPlatform()
  await platform.load()
  const info = deferred<{ model: string; provider: string }>()
  vi.mocked(getGlobalModelInfo).mockReturnValue(info.promise)
  const { result } = renderHook(() => useStatusSnapshot('open', requestGateway, scope))
  await waitFor(() => expect(getGlobalModelInfo).toHaveBeenCalled())

  act(() => platform.publish({ ...platformSnapshot('user-a', 2), phase: 'signed_out', account: null }))
  await waitFor(() => expect(result.current.inferenceStatus?.source).toBe('runtime_check'))
  await act(async () => info.resolve({ model: '', provider: '' }))
  expect(result.current.inferenceStatus).toMatchObject({ ready: false, source: 'runtime_check' })
})

it('rechecks when an external catalog refresh revokes availability and clears readiness on disconnect', async () => {
  const platform = installPlatform()
  await platform.load()

  const { result, rerender } = renderHook(({ state }) => useStatusSnapshot(state, requestGateway, scope), {
    initialProps: { state: 'open' }
  })

  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(true))
  platform.list.mockResolvedValue([{ ...platformModel(), state: 'quota_exhausted' }])
  await act(async () => platformModelCatalog().load())
  await waitFor(() => expect(result.current.inferenceStatus?.ready).toBe(false))

  rerender({ state: 'closed' })
  expect(result.current.inferenceStatus).toBeNull()
})
