// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { rotateFreshDraftKey } from '@/store/composer'
import { $daybreakByProfile, daybreakKey } from '@/store/daybreak'
import { $modelPresets, getModelPreset, setModelPreset } from '@/store/model-presets'
import { $notifications } from '@/store/notifications'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  $selectedStoredSessionId,
  setCurrentModelSource
} from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { useModelMenuController } from './use-model-menu-controller'

beforeEach(() => {
  $modelPresets.set({})
  $sessionStates.set({})
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $currentModel.set('model-a')
  $currentProvider.set('provider')
  $currentReasoningEffort.set('')
  rotateFreshDraftKey()
})

afterEach(() => {
  cleanup()
  $modelPresets.set({})
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  setCurrentModelSource('')
  $currentReasoningEffort.set('')
  localStorage.clear()
})

it('keeps preview options within the conversation and owner while preserving them across model switches', async () => {
  setModelPreset('provider', 'model-b', { effort: 'ultra' })

  const request = vi.fn(
    async () => ({ providers: [{ slug: 'provider', name: 'Provider', models: ['model-a', 'model-b'] }] }) as never
  )

  const client = new QueryClient()

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { result, rerender } = renderHook(
    ({ owner, profile }) =>
      useModelMenuController({
        ownerConnectionId: owner,
        profile,
        requestGateway: request,
        onSelectModel: vi.fn()
      }),
    { initialProps: { owner: 'owner-a', profile: 'work' }, wrapper }
  )

  await waitFor(() => expect(result.current.modelOptions.data).toBeTruthy())
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({})
  act(() =>
    result.current.controller.setOptions(
      { effort: 'high' },
      { provider: 'provider', model: 'model-b', isActive: false }
    )
  )
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({ effort: 'high' })
  act(() => $currentModel.set('model-b'))
  act(() => $currentModel.set('model-a'))
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({ effort: 'high' })
  rerender({ owner: 'owner-b', profile: 'work' })
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({})
  rerender({ owner: 'owner-a', profile: 'other-profile' })
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({})
  rerender({ owner: 'owner-a', profile: 'work' })
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({ effort: 'high' })
  act(() => rotateFreshDraftKey())
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({})
})

it('does not reuse another runtime conversation preset for the same model', async () => {
  $activeSessionId.set('runtime-a')
  $selectedStoredSessionId.set('stored-a')

  const request = vi.fn(
    async () => ({ providers: [{ slug: 'provider', name: 'Provider', models: ['model-a', 'model-b'] }] }) as never
  )

  const client = new QueryClient()

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { result } = renderHook(
    () =>
      useModelMenuController({
        ownerConnectionId: 'owner-a',
        profile: 'work',
        requestGateway: request,
        onSelectModel: vi.fn()
      }),
    { wrapper }
  )

  await waitFor(() => expect(result.current.modelOptions.data).toBeTruthy())
  act(() =>
    result.current.controller.setOptions(
      { effort: 'high' },
      { provider: 'provider', model: 'model-b', isActive: false }
    )
  )
  act(() => {
    $activeSessionId.set('runtime-b')
    $selectedStoredSessionId.set('stored-b')
  })
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({})
  act(() => {
    $activeSessionId.set('runtime-a-new')
    $selectedStoredSessionId.set('stored-a')
  })
  expect(result.current.controller.presetFor('provider', 'model-b')).toEqual({ effort: 'high' })
})

it('applies active draft reasoning locally without replacing the global preference or the next draft preset', async () => {
  setModelPreset('provider', 'model-a', { effort: 'low' })

  const request = vi.fn(
    async (_method: string, _params?: Record<string, unknown>) =>
      ({ providers: [{ slug: 'provider', name: 'Provider', models: ['model-a'] }] }) as never
  )

  const client = new QueryClient()

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { result } = renderHook(
    () =>
      useModelMenuController({
        ownerConnectionId: 'owner-a',
        profile: 'work',
        requestGateway: request,
        onSelectModel: vi.fn()
      }),
    { wrapper }
  )

  await waitFor(() => expect(result.current.modelOptions.data).toBeTruthy())
  await act(async () =>
    result.current.controller.setOptions({ effort: 'high' }, { provider: 'provider', model: 'model-a', isActive: true })
  )

  expect($currentReasoningEffort.get()).toBe('high')
  expect(result.current.controller.presetFor('provider', 'model-a')).toEqual({ effort: 'high' })
  expect(getModelPreset('provider', 'model-a')).toEqual({ effort: 'low' })
  expect(request.mock.calls.some(call => call[0] === 'config.set')).toBe(false)
  act(() => rotateFreshDraftKey())
  expect(result.current.controller.presetFor('provider', 'model-a')).toEqual({})
})

it('a level picked while a reply streams applies from the next message instead of failing (MP-24)', async () => {
  $activeSessionId.set('runtime-1')
  $currentModel.set('gemini-3.1-pro')
  $currentProvider.set('google')
  $notifications.set([])

  const requestGateway = vi.fn(async (method: string) =>
    method === 'config.set'
      ? { ok: true, operation: 'reasoning', status: 'deferred', value: 'high' }
      : { providers: [] }
  )

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { result } = renderHook(
    () => useModelMenuController({ onSelectModel: vi.fn(), requestGateway: requestGateway as never }),
    { wrapper }
  )

  result.current.controller.setOptions(
    { effort: 'high' },
    { isActive: true, model: 'gemini-3.1-pro', provider: 'google' }
  )

  await waitFor(() =>
    expect($notifications.get()).toContainEqual(
      expect.objectContaining({ kind: 'info', message: 'high applies from your next message' })
    )
  )
  expect($notifications.get().some(n => n.kind === 'error')).toBe(false)
})

it('a queued Daybreak flip goes to the connection that was clicked, not the one focused later', async () => {
  $daybreakByProfile.set({})

  let releaseFirst!: (value: unknown) => void

  const firstReply = new Promise(resolve => {
    releaseFirst = resolve
  })

  const local = {
    request: vi.fn((method: string, params?: Record<string, unknown>) =>
      method === 'config.set' && params?.value === true ? firstReply : Promise.resolve({ value: params?.value })
    )
  }

  const remote = {
    request: vi.fn(async (_method: string, params?: Record<string, unknown>) => ({ value: params?.value }))
  }

  // The primary menu's shared requester follows focus: it reaches whichever connection is focused when called.
  const focusedRequest = vi.fn(async () => ({ providers: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const { rerender, result } = renderHook(
    ({ gateway, connection }: { connection: string; gateway: typeof local }) =>
      useModelMenuController({
        gateway: gateway as unknown as HermesGateway,
        onSelectModel: vi.fn(),
        ownerConnectionId: connection,
        profile: 'default',
        requestGateway: focusedRequest as never
      }),
    { initialProps: { connection: 'local', gateway: local }, wrapper }
  )

  result.current.controller.daybreak?.set(true)
  result.current.controller.daybreak?.set(false) // queued behind the first write
  rerender({ connection: 'remote', gateway: remote }) // focus moves to another connection's `default`

  releaseFirst({ value: true })
  await waitFor(() => expect(local.request).toHaveBeenCalledTimes(2))

  expect(local.request).toHaveBeenLastCalledWith('config.set', { key: 'daybreak', profile: 'default', value: false })
  expect(remote.request).not.toHaveBeenCalledWith('config.set', expect.anything())
  expect(focusedRequest).not.toHaveBeenCalledWith('config.set', expect.anything())
  await waitFor(() => expect($daybreakByProfile.get()[daybreakKey('default', 'local')]).toBe(false))
})
