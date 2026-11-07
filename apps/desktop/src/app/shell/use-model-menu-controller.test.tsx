// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { rotateFreshDraftKey } from '@/store/composer'
import { $modelPresets, getModelPreset, setModelPreset } from '@/store/model-presets'
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
