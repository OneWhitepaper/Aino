// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { platformAccountActions } from '@/api/platform'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog } from '@/store/platform-models'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformModel } from '../../../shared/platform-contract'

import { useDefaultMainModel } from './use-default-main-model'

afterEach(() => {
  cleanup()
  clearGatewayManagedCapabilities()
  Reflect.deleteProperty(window, 'hermesDesktop')
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  localStorage.clear()
})

async function preparePlatform() {
  const list = vi.fn().mockResolvedValue([platformModel()])
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        capabilities: async () => ({}),
        status: async () => platformSnapshot(),
        onChanged: () => () => {}
      },
      platformModels: {
        list,
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  const account = platformAccountActions(window.hermesDesktop.platformAccount)
  await account.refresh()
  setApiRequestConnection('default-main-test')
  recordGatewayReadyCapability(
    { connectionId: 'default-main-test', profile: 'work' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  const catalog = platformModelCatalog()
  await catalog.load()

  return { account, catalog, list }
}

it('retains the applied built-in display during a same-owner refresh while blocking apply', async () => {
  const { catalog, list } = await preparePlatform()
  const { result } = renderHook(() => useDefaultMainModel({ provider: '', model: '' }, 'work'))
  expect(result.current.appliedPlatformModel?.display_name).toBe('Fixture Model')
  expect(result.current.platformCanApply).toBe(true)
  let complete!: (models: PlatformModel[]) => void
  list.mockReturnValueOnce(new Promise(resolve => (complete = resolve)))
  let refresh!: Promise<void>
  act(() => {
    refresh = result.current.platform.refresh()
  })

  expect(result.current.platform.phase).toBe('loading')
  expect(result.current.appliedPlatformModel?.display_name).toBe('Fixture Model')
  expect(result.current.appliedPlatformId).toBe('catalog-a')
  expect(result.current.selectedPlatformId).toBe('catalog-a')
  expect(result.current.platformCanApply).toBe(false)
  await act(async () => {
    complete([platformModel()])
    await refresh
  })

  expect(result.current.platform.phase).toBe('ready')
  expect(result.current.appliedPlatformModel?.display_name).toBe('Fixture Model')
  expect(result.current.platformCanApply).toBe(true)
})

it('does not retain the refresh display for another route or account revision', async () => {
  const { account, catalog, list } = await preparePlatform()

  const { result, rerender } = renderHook(({ profile }) => useDefaultMainModel({ provider: '', model: '' }, profile), {
    initialProps: { profile: 'work' }
  })

  let complete!: (models: PlatformModel[]) => void
  list.mockReturnValue(new Promise(resolve => (complete = resolve)))
  let refresh!: Promise<void>
  act(() => {
    refresh = result.current.platform.refresh()
  })
  expect(result.current.appliedPlatformId).toBe('catalog-a')
  rerender({ profile: 'other-profile' })
  expect(result.current.appliedPlatformModel).toBeUndefined()
  expect(result.current.platformCanApply).toBe(false)
  rerender({ profile: 'work' })
  expect(result.current.appliedPlatformId).toBe('catalog-a')

  act(() => account.snapshot.set(platformSnapshot('user-a', 2)))
  await waitFor(() => expect(result.current.platform.models).toEqual([]))
  expect(result.current.appliedPlatformModel).toBeUndefined()
  expect(result.current.appliedPlatformId).toBe('')
  expect(result.current.platformCanApply).toBe(false)
  await act(async () => {
    complete([platformModel()])
    await refresh
  })
})

it.each(['offline', 'reauth_required'] as const)('displays and permits a retained device model while management is %s', async phase => {
  const { account, catalog } = await preparePlatform()
  window.hermesDesktop.platformAccount.status = async () => ({ ...platformSnapshot(), phase, model_identity_ready: true })
  await account.refresh()
  await catalog.load()
  const { result } = renderHook(() => useDefaultMainModel({ provider: '', model: '' }, 'work'))

  expect(result.current.appliedPlatformId).toBe('catalog-a')
  expect(result.current.platformCanApply).toBe(true)
})
