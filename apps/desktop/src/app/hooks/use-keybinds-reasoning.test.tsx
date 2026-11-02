// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { resetBinding, setBinding } from '@/store/keybinds'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  markComposerSelectionDefault,
  setCurrentModelSource,
  setCurrentReasoningEffort
} from '@/store/session'

import { useKeybinds } from './use-keybinds'

vi.mock('@/themes/context', () => ({ useTheme: () => ({ resolvedMode: 'light', setMode: vi.fn() }) }))
vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  activeGatewayConnectionId: () => null
}))

beforeEach(() => {
  $activeGatewayProfile.set('default')
  $activeSessionId.set('runtime-a')
  $currentModel.set('model-a')
  $currentProvider.set('provider')
  setCurrentReasoningEffort('low')
  setBinding('composer.reasoningUp', ['alt+up'])
})

afterEach(() => {
  cleanup()
  resetBinding('composer.reasoningUp')
  $activeSessionId.set(null)
  $currentModel.set('')
  $currentProvider.set('')
  setCurrentReasoningEffort('')
  setCurrentModelSource('')
})

function mount(requestGateway: ReturnType<typeof vi.fn>) {
  return renderHook(
    () =>
      useKeybinds({
        requestGateway: requestGateway as <T>(method: string, params?: Record<string, unknown>) => Promise<T>,
        archiveSelectedSession: vi.fn(),
        openNewSessionTab: vi.fn(),
        startFreshSession: vi.fn(),
        toggleCommandCenter: vi.fn(),
        toggleSelectedPin: vi.fn()
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>
    }
  )
}

const pressUp = () =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true })
    )
  })

it('steps the conversation reasoning setting without requiring model capability metadata', async () => {
  const request = vi.fn(async () => ({ value: 'medium' }))
  mount(request)
  pressUp()
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('config.set', { key: 'reasoning', session_id: 'runtime-a', value: 'medium' })
  )
  expect($currentReasoningEffort.get()).toBe('medium')
})

it('does not let a previous conversation shortcut response overwrite a new draft', async () => {
  let complete!: (value: { value: string }) => void

  const request = vi.fn(
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )

  mount(request)
  pressUp()
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  act(() => {
    $activeSessionId.set(null)
    markComposerSelectionDefault()
    setCurrentReasoningEffort('low')
  })
  await act(async () => complete({ value: 'high' }))
  expect($currentReasoningEffort.get()).toBe('low')
})
