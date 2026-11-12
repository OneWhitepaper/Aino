import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { platformModelCatalog } from '@/store/platform-models'
import { setCurrentModel, setCurrentPlatformOwner, setCurrentProvider } from '@/store/session'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformModel } from '../../../shared/platform-contract'

import { ModelPill } from './composer/model-pill'
import { ReasoningPill } from './composer/reasoning-pill'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from './session-view'
import { useChatBarState } from './use-chat-bar-state'

function ModelControls() {
  const state = useChatBarState({
    activeGatewayProfile: 'default',
    activeSessionId: null,
    contextSuggestions: [],
    currentModel: 'catalog-a',
    currentProvider: 'aino',
    gateway: null,
    gatewayOpen: false,
    modelMenuContent: <div />,
    reasoningMenuContent: <div />
  })

  return (
    <>
      <ModelPill disabled={false} model={state.model} />
      <ReasoningPill disabled={false} model={state.model} />
    </>
  )
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentPlatformOwner('')
})

it('replaces the real Bot tile loader with an enabled model choice once its model catalog resolves empty', async () => {
  const options = deferred<{ model: string; provider: string; providers: [] }>()
  const request = vi.fn(async () => options.promise)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const view = {
    ...PRIMARY_SESSION_VIEW,
    kind: 'tile' as const,
    $model: atom(''),
    $provider: atom(''),
    $runtimeId: atom('bot-runtime'),
    $storedId: atom('bot-stored')
  }

  function EmptyBotControls() {
    const state = useChatBarState({
      activeGatewayProfile: 'default',
      activeSessionId: 'bot-runtime',
      contextSuggestions: [],
      currentModel: '',
      currentProvider: '',
      gateway: null,
      gatewayOpen: true,
      modelOptionsProfile: 'writer',
      requestModelOptionsForOwner: request as never,
      modelMenuContent: <button type="button">Available Bot model</button>
    })

    return <ModelPill disabled={false} model={state.model} />
  }

  render(
    <QueryClientProvider client={queryClient}>
      <SessionViewProvider value={view}>
        <EmptyBotControls />
      </SessionViewProvider>
    </QueryClientProvider>
  )
  expect(screen.getByRole('status', { name: /loading/i })).toBeTruthy()
  expect(screen.queryByText('Choose model')).toBeNull()

  await act(async () => options.resolve({ model: '', provider: '', providers: [] }))
  await waitFor(() => expect(screen.queryByRole('status', { name: /loading/i })).toBeNull())
  const picker = screen.getByRole('button', { name: 'Open model picker' })
  expect(picker.textContent).toContain('Choose model')
  expect(picker.hasAttribute('disabled')).toBe(false)
  fireEvent.pointerDown(picker, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  expect(await screen.findByRole('menu')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Available Bot model' })).toBeTruthy()
})

it('keeps known model controls in place during an explicit refresh of the same account catalog', async () => {
  const model = platformModel()
  model.capabilities.reasoning = true
  const refreshed = deferred<PlatformModel[]>()
  const list = vi.fn().mockResolvedValueOnce([model]).mockReturnValueOnce(refreshed.promise)
  const account = platformSnapshot()
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
      platformModels: {
        list,
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  const catalog = platformModelCatalog()
  await catalog.load()
  setCurrentModel(model.id)
  setCurrentProvider('aino')
  setCurrentPlatformOwner('user-a', 'http://127.0.0.1:7001')
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ModelControls />
    </QueryClientProvider>
  )
  const modelButton = screen.getByRole('button', { name: name => name.includes(model.display_name) })
  const reasoningButton = screen.getByTestId('reasoning-pill')
  let refresh!: Promise<void>

  await act(() => catalog.load())
  expect(catalog.state.get().phase).toBe('ready')
  expect(list).toHaveBeenCalledTimes(1)

  act(() => {
    refresh = catalog.refresh()
  })

  expect(catalog.state.get().phase).toBe('loading')
  expect(list).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: name => name.includes(model.display_name) })).toBe(modelButton)
  expect(screen.getByText(model.display_name)).toBeTruthy()
  expect(screen.queryByTestId('reasoning-pill')).toBe(reasoningButton)

  await act(async () => {
    refreshed.resolve([{ ...model, capabilities: { ...model.capabilities, reasoning: false } }])
    await refresh
  })

  expect(screen.getByRole('button', { name: name => name.includes(model.display_name) })).toBe(modelButton)
  expect(screen.queryByTestId('reasoning-pill')).toBeNull()
})
