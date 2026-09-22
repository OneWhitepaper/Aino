import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { ModelPill } from '@/app/chat/composer/model-pill'
import { ModelMenuCloseContext, ModelMenuPanel } from '@/app/shell/model-menu-panel'
import { ModelPickerDialog } from '@/components/model-picker'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { I18nProvider } from '@/i18n'
import { modelOptionsQueryKey } from '@/lib/model-options'
import { $confirmRequest, settleConfirm } from '@/store/confirm'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { $modelPresets, modelPresetKey } from '@/store/model-presets'
import { platformModelCatalog } from '@/store/platform-models'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $busy,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  setCurrentModel,
  setCurrentPlatformOwner,
  setCurrentProvider
} from '@/store/session'
import {
  $sessionStates,
  publishSessionState,
  type SessionTileDelegate,
  setSessionTileDelegate
} from '@/store/session-states'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { useModelControls } from './use-model-controls'

const notices = vi.hoisted(() => ({ notify: vi.fn(), notifyError: vi.fn(), dismissNotification: vi.fn() }))
vi.mock('@/store/notifications', () => notices)
stubMenuDomApis()
stubResizeObserver()

let backend = { model: 'byok-old', provider: 'custom:test' } as Record<string, unknown>
let bind: ReturnType<typeof vi.fn>
let clear: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let broadcast: (snapshot: ReturnType<typeof platformSnapshot>) => void

beforeEach(async () => {
  vi.clearAllMocks()
  $activeGatewayProfile.set('default')
  $activeSessionId.set('runtime-a')
  $busy.set(false)
  $modelPresets.set({})
  $currentFastMode.set(false)
  $currentReasoningEffort.set('low')
  setCurrentProvider('custom:test')
  setCurrentModel('byok-old')
  setCurrentPlatformOwner('')
  $sessionStates.set({
    'runtime-a': { model: 'byok-old', provider: 'custom:test', busy: false, messages: [] }
  } as never)
  setSessionTileDelegate({
    updateSession: (id: string, update: Parameters<SessionTileDelegate['updateSession']>[1]) => {
      const previous = $sessionStates.get()[id]

      if (previous) {
        publishSessionState(id, update(previous))
      }
    }
  } as never)
  backend = { model: 'byok-old', provider: 'custom:test' }
  bind = vi.fn(async () => {
    backend.model_status = 'ready'

    return { ok: true }
  })
  clear = vi.fn(async () => undefined)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: (listener: typeof broadcast) => {
          broadcast = listener

          return () => {}
        }
      },
      platformModels: {
        list: async () => [platformModel(), platformModel('catalog-b')],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' }),
        bind,
        clear
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  recordGatewayReadyCapability({ profile: 'default' }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  recordGatewayReadyCapability(
    { connectionId: 'connection-b', profile: 'profile-b' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  request = vi.fn(async (method, params) => {
    if (method === 'config.set') {
      if (params.key === 'reasoning') {
        return {}
      }

      if (params.model_source === 'aino' && !params.confirm_expensive_model) {
        return { confirm_required: true, confirm_message: 'Switch the model for this conversation?' }
      }

      backend =
        params.model_source === 'aino'
          ? {
              provider: 'aino',
              model_id: params.value,
              model_source: 'aino',
              model_status: 'awaiting_managed_credentials',
              platform_owner: { user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' }
            }
          : { provider: 'custom:test', model: params.value.split(' ')[0] }

      return {}
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'fixture' }
    }

    if (method === 'model.options') {
      return { session_info: backend, providers: [] }
    }

    throw new Error(method)
  })
})

function setManagedCurrent() {
  setCurrentProvider('aino')
  setCurrentModel('catalog-a')
  setCurrentPlatformOwner('user-a', 'http://127.0.0.1:7001')
  $sessionStates.set({
    'runtime-a': {
      ...$sessionStates.get()['runtime-a'],
      provider: 'aino',
      model: 'catalog-a',
      reasoningEffort: 'low',
      fast: false,
      platformModel: {
        modelId: 'catalog-a',
        ownerUserId: 'user-a',
        platformOrigin: 'http://127.0.0.1:7001',
        status: 'ready'
      }
    }
  })
}

function installCustomPickerRequests(slug = 'test') {
  const providers = [
    {
      slug,
      name: 'Fixture custom',
      aliases: [slug, 'custom:test'],
      models: ['byok-new'],
      capabilities: { 'byok-new': { reasoning: true, fast: true } }
    }
  ]

  request.mockImplementation(async (method, params) => {
    if (method === 'model.options') {
      return { providers, session_info: backend }
    }

    if (method === 'config.set') {
      if (params.key === 'model') {
        backend = { provider: 'custom:test', model: 'byok-new' }
      }

      return {}
    }

    throw new Error(method)
  })
}

function PickerHarness({ client, close }: { client: QueryClient; close: () => void }) {
  const { selectModel } = useModelControls({ queryClient: client, requestGateway: request as never })

  return (
    <DropdownMenu open>
      <DropdownMenuContent>
        <ModelMenuCloseContext.Provider value={close}>
          <ModelMenuPanel onSelectModel={selectModel} requestGateway={request as never} />
        </ModelMenuCloseContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PillHarness({ client }: { client: QueryClient }) {
  const { selectModel } = useModelControls({ queryClient: client, requestGateway: request as never })

  return (
    <ModelPill
      disabled={false}
      model={{
        canSwitch: true,
        model: '',
        provider: '',
        modelMenuContent: <ModelMenuPanel onSelectModel={selectModel} requestGateway={request as never} />
      }}
    />
  )
}

function FullPickerHarness({ client }: { client: QueryClient }) {
  const { selectModel } = useModelControls({ queryClient: client, requestGateway: request as never })

  return (
    <I18nProvider>
      <ModelPickerDialog
        currentModel="byok-old"
        currentProvider="custom:test"
        includePlatform
        onOpenChange={() => undefined}
        onSelect={selectModel}
        open
      />
    </I18nProvider>
  )
}

it('keeps the reopened ModelPill menu when exit animation retains its pending selection content', async () => {
  setManagedCurrent()
  installCustomPickerRequests()
  $modelPresets.set({ [modelPresetKey('test', 'byok-new')]: { effort: 'high', fast: true } })
  // jsdom has no animation engine/live computed styles. Let real Radix Presence
  // observe an unfinished exit animation; do not forceMount or remount content.
  const computedStyle = window.getComputedStyle.bind(window)

  const styles = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const actual = computedStyle(element, pseudo)

    if (!element.matches('[data-slot="dropdown-menu-content"]')) {
      return actual
    }

    return new Proxy(actual, {
      get(target, property) {
        if (property === 'animationName') {
          return element.getAttribute('data-state') === 'closed' ? 'fixture-exit' : 'fixture-enter'
        }

        const value = Reflect.get(target, property)

        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  })

  const pending = deferred<void>()
  clear.mockReturnValueOnce(pending.promise)
  const client = new QueryClient()

  try {
    render(
      <QueryClientProvider client={client}>
        <PillHarness client={client} />
      </QueryClientProvider>
    )
    const trigger = screen.getByRole('button')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Custom models' }))
    const content = screen.getByRole('menu')
    const search = content.querySelector('input')
    fireEvent.click(await screen.findByText(/byok.*new/i))
    await waitFor(() => expect(clear).toHaveBeenCalled())
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(content.getAttribute('data-state')).toBe('closed')
    expect(content.isConnected).toBe(true)
    expect(content.querySelector('input')).toBe(search)
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(screen.getAllByRole('menu')).toContain(content)
    expect(content.querySelector('input')).toBe(search)
    await act(async () => pending.resolve())
    expect($sessionStates.get()['runtime-a']).toMatchObject({
      provider: 'custom:test',
      model: 'byok-new',
      reasoningEffort: 'low',
      fast: false
    })
    expect([$currentReasoningEffort.get(), $currentFastMode.get()]).toEqual(['low', false])
    expect(request.mock.calls.filter(([method, params]) => method === 'config.set' && params.key !== 'model')).toEqual(
      []
    )
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(content.getAttribute('data-state')).toBe('open')
  } finally {
    cleanup()
    styles.mockRestore()
  }
})

it('accepts a bare custom dropdown slug against canonical backend identity and can retry failed cleanup', async () => {
  setManagedCurrent()
  installCustomPickerRequests()
  const client = new QueryClient()
  const close = vi.fn()

  const view = render(
    <QueryClientProvider client={client}>
      <PickerHarness client={client} close={close} />
    </QueryClientProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  fireEvent.click(await screen.findByText(/byok.*new/i))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:test', 'byok-new'])
  expect(notices.notifyError).not.toHaveBeenCalled()

  view.unmount()
  setManagedCurrent()
  clear.mockRejectedValueOnce(new Error('native clear failed'))
  notices.notify.mockClear()
  render(
    <QueryClientProvider client={client}>
      <PickerHarness client={client} close={close} />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  fireEvent.click(await screen.findByText(/byok.*new/i))
  await waitFor(() => expect(notices.notify).toHaveBeenCalled())
  const beforeRetry = clear.mock.calls.length
  await act(() => notices.notify.mock.calls.at(-1)?.[0]?.action.onClick())
  expect(clear.mock.calls.length).toBe(beforeRetry + 1)
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:test', 'byok-new'])
})

it.each(['navigate', 'reopen'] as const)(
  'fences dropdown preset and dismissal after %s during a reverse switch',
  async kind => {
    setManagedCurrent()
    installCustomPickerRequests('custom:test')
    $modelPresets.set({ [modelPresetKey('custom:test', 'byok-new')]: { effort: 'high', fast: true } })
    const pending = deferred<void>()
    clear.mockReturnValueOnce(pending.promise)
    const client = new QueryClient()
    const close = vi.fn()

    const picker = (key: string) => (
      <QueryClientProvider client={client}>
        <PickerHarness client={client} close={close} key={key} />
      </QueryClientProvider>
    )

    const view = render(picker('first'))
    fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
    fireEvent.click(await screen.findByText(/byok.*new/i))
    await waitFor(() => expect(clear).toHaveBeenCalled())

    if (kind === 'navigate') {
      act(() => {
        $sessionStates.set({
          ...$sessionStates.get(),
          'runtime-b': {
            ...$sessionStates.get()['runtime-a'],
            model: 'other-model',
            provider: 'custom:other',
            platformModel: null,
            reasoningEffort: 'medium',
            fast: false
          }
        })
        $activeSessionId.set('runtime-b')
        setCurrentProvider('custom:other')
        setCurrentModel('other-model')
        $currentReasoningEffort.set('medium')
        $currentFastMode.set(false)
      })
    }

    view.rerender(picker('second'))
    await act(async () => pending.resolve())
    expect($sessionStates.get()['runtime-a']).toMatchObject({
      provider: 'custom:test',
      model: 'byok-new',
      reasoningEffort: 'low',
      fast: false
    })
    expect($currentReasoningEffort.get()).toBe(kind === 'navigate' ? 'medium' : 'low')
    expect($currentFastMode.get()).toBe(false)

    if (kind === 'navigate') {
      expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:other', 'other-model'])
      expect($sessionStates.get()['runtime-b']).toMatchObject({
        reasoningEffort: 'medium',
        fast: false,
        model: 'other-model'
      })
    }

    expect(close).not.toHaveBeenCalled()
    expect(request.mock.calls.filter(([method, params]) => method === 'config.set' && params.key !== 'model')).toEqual(
      []
    )
  }
)

it('offers outstanding native cleanup after a lost reverse-switch acknowledgement without resending config', async () => {
  setManagedCurrent()
  let nativeBindingRetained = true
  clear.mockImplementation(async () => {
    nativeBindingRetained = false
  })
  const result = controls()
  request.mockImplementationOnce(async () => {
    backend = { provider: 'custom:test', model: 'byok-new' }
    throw new Error('config acknowledgement lost')
  })
  await act(async () =>
    expect(await result.current.selectModel({ provider: 'custom:test', model: 'byok-new' })).toBe(false)
  )
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:test', 'byok-new'])
  const retry = notices.notify.mock.calls.at(-1)?.[0]?.action
  expect(retry).toBeDefined()
  clear.mockRejectedValueOnce(new Error('native clear offline'))
  await act(() => retry.onClick())
  expect(nativeBindingRetained).toBe(true)
  await act(() => notices.notify.mock.calls.at(-1)?.[0]?.action.onClick())
  expect(nativeBindingRetained).toBe(false)
  expect(
    request.mock.calls.filter(([method, params]) => method === 'config.set' && params.key === 'model')
  ).toHaveLength(1)
  expect(request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false)
})

afterEach(() => {
  settleConfirm(false)
  cleanup()
  $activeSessionId.set(null)
  $sessionStates.set({})
  $busy.set(false)
  $activeGatewayProfile.set('default')
  clearGatewayManagedCapabilities()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

function controls() {
  return renderHook(() => useModelControls({ queryClient: new QueryClient(), requestGateway: request as never })).result
}

it.each(['dropdown', 'dialog'] as const)('applies a managed model with one selection from the %s', async picker => {
  const client = new QueryClient()
  const close = vi.fn()

  render(
    <QueryClientProvider client={client}>
      {picker === 'dropdown' ? <PickerHarness client={client} close={close} /> : <FullPickerHarness client={client} />}
    </QueryClientProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Aino models' }))
  fireEvent.click((await screen.findAllByRole('option', { name: /Fixture Model/i }))[0])

  await waitFor(() => expect($sessionStates.get()['runtime-a'].platformModel?.status).toBe('ready'))
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['aino', 'catalog-a'])
  expect(
    request.mock.calls.filter(([method, params]) => method === 'config.set' && params.key === 'model')
  ).toHaveLength(1)
  expect(notices.notify).not.toHaveBeenCalled()
  expect(notices.notifyError).not.toHaveBeenCalled()

  if (picker === 'dropdown') {
    expect(close).toHaveBeenCalledOnce()
  }
})

it('reconciles staged binding failure and retries authorization without replaying config or a prompt', async () => {
  bind.mockResolvedValueOnce({ ok: false, error: { code: 'gateway_binding_failed' } })
  const result = controls()
  await act(async () => expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-a' })).toBe(false))
  expect($sessionStates.get()['runtime-a'].platformModel).toMatchObject({
    modelId: 'catalog-a',
    status: 'awaiting_managed_credentials'
  })
  expect(request).toHaveBeenCalledWith('model.options', {
    session_id: 'runtime-a',
    profile: 'default',
    include_session_info: true
  })
  const retry = notices.notify.mock.calls.at(-1)?.[0]?.action
  expect(retry).toBeDefined()
  await act(() => retry.onClick())
  expect($sessionStates.get()['runtime-a'].platformModel?.status).toBe('ready')
  expect(
    request.mock.calls.filter(([method, params]) => method === 'config.set' && params.key === 'model')
  ).toHaveLength(1)
  expect(request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false)
})

it('clears stale live reasoning through config.set for a non-reasoning Aino selection', async () => {
  $currentReasoningEffort.set('high')
  const result = controls()

  await act(async () => expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-a' })).toBe(true))

  expect(request).toHaveBeenCalledWith('config.set', { key: 'reasoning', session_id: 'runtime-a', value: '' })
  expect($currentReasoningEffort.get()).toBe('')
  expect($sessionStates.get()['runtime-a'].reasoningEffort).toBe('')
})

it('clears stale live reasoning through config.set from the full picker too', async () => {
  $currentReasoningEffort.set('high')
  const client = new QueryClient()

  render(
    <QueryClientProvider client={client}>
      <FullPickerHarness client={client} />
    </QueryClientProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Aino models' }))
  fireEvent.click((await screen.findAllByRole('option', { name: /Fixture Model/i }))[0])

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('config.set', { key: 'reasoning', session_id: 'runtime-a', value: '' })
  )
  expect($currentReasoningEffort.get()).toBe('')
})

it('keeps authoritative BYOK after native cleanup fails and rejects busy managed switches before painting', async () => {
  setCurrentProvider('aino')
  setCurrentModel('catalog-a')
  setCurrentPlatformOwner('user-a', 'http://127.0.0.1:7001')
  $sessionStates.set({
    'runtime-a': {
      ...$sessionStates.get()['runtime-a'],
      provider: 'aino',
      model: 'catalog-a',
      platformModel: {
        modelId: 'catalog-a',
        ownerUserId: 'user-a',
        platformOrigin: 'http://127.0.0.1:7001',
        status: 'ready'
      },
      busy: true
    }
  })
  const result = controls()
  await act(async () =>
    expect(await result.current.selectModel({ provider: 'custom:test', model: 'byok-new' })).toBe(false)
  )
  expect(request).not.toHaveBeenCalled()
  expect($currentProvider.get()).toBe('aino')
  $sessionStates.set({ 'runtime-a': { ...$sessionStates.get()['runtime-a'], busy: false } })
  clear.mockRejectedValueOnce(new Error('cleanup failed'))
  await act(async () =>
    expect(await result.current.selectModel({ provider: 'custom:test', model: 'byok-new' })).toBe(false)
  )
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:test', 'byok-new'])
  expect($sessionStates.get()['runtime-a'].platformModel).toBeNull()
  expect(request).toHaveBeenCalledWith('model.options', {
    session_id: 'runtime-a',
    profile: 'default',
    include_session_info: true
  })

  request.mockClear()
  $sessionStates.set({ 'runtime-a': { ...$sessionStates.get()['runtime-a'], awaitingResponse: true } })
  await act(async () => expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-b' })).toBe(false))
  expect(request).not.toHaveBeenCalled()
  expect($currentProvider.get()).toBe('custom:test')
})

it('awaits one managed selection and keeps completion on its original tile after navigation', async () => {
  const pending = deferred<{ ok: boolean }>()
  bind.mockReturnValueOnce(pending.promise)
  const result = controls()
  const switchPromise = result.current.selectModel({ provider: 'aino', model: 'catalog-a' })
  await act(async () => {})
  await expect(result.current.selectModel({ provider: 'aino', model: 'catalog-b' })).resolves.toBe(false)
  $activeSessionId.set('runtime-b')
  setCurrentModel('other-model')
  setCurrentProvider('other-provider')
  backend.model_status = 'ready'
  pending.resolve({ ok: true })
  await act(() => switchPromise)
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['other-provider', 'other-model'])
  expect($sessionStates.get()['runtime-a'].platformModel?.status).toBe('ready')
})

it('fences stale confirmations and an account transition during accepted config before requesting funding', async () => {
  request.mockResolvedValueOnce({ confirm_required: true, confirm_message: 'Switch model?' })
  const result = controls()
  await act(async () => expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-a' })).toBe(false))
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:test', 'byok-old'])
  expect($confirmRequest.get()).not.toBeNull()
  act(() => broadcast(platformSnapshot('user-b', 2)))
  await act(async () => settleConfirm(true))
  expect(request.mock.calls.filter(([method]) => method === 'config.set')).toHaveLength(1)
  expect(bind).not.toHaveBeenCalled()

  act(() => broadcast(platformSnapshot('user-a', 3)))
  await platformModelCatalog().load()
  const pending = deferred<object>()
  request.mockReturnValueOnce(pending.promise)
  const switched = result.current.selectModel({ provider: 'aino', model: 'catalog-a' })
  act(() => broadcast(platformSnapshot('user-b', 4)))
  setCurrentProvider('custom:other')
  setCurrentModel('new-owner-model')
  pending.resolve({})
  await act(async () => expect(await switched).toBe(false))
  expect(bind).not.toHaveBeenCalled()
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:other', 'new-owner-model'])
})

it('rolls back a rejected managed config but reconciles a lost acknowledgement of a staged model', async () => {
  const result = controls()
  request.mockRejectedValueOnce(new Error('write rejected'))
  await act(async () => expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-a' })).toBe(false))
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:test', 'byok-old'])
  expect($sessionStates.get()['runtime-a'].platformModel).toBeFalsy()
  request.mockImplementationOnce(async () => {
    backend = {
      provider: 'aino',
      model_id: 'catalog-a',
      model_source: 'aino',
      model_status: 'awaiting_managed_credentials'
    }
    throw new Error('acknowledgement lost')
  })
  await act(async () => expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-a' })).toBe(false))
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['aino', 'catalog-a'])
  expect($sessionStates.get()['runtime-a'].platformModel).toMatchObject({
    modelId: 'catalog-a',
    status: 'awaiting_managed_credentials'
  })
  expect(notices.notify.mock.calls.at(-1)?.[0]?.action).toBeDefined()
  expect(bind).not.toHaveBeenCalled()
})

it('confirms Aino-to-Aino on a secondary tile and keeps its binding/cache on the captured profile', async () => {
  $sessionStates.set({
    ...$sessionStates.get(),
    'runtime-b': {
      ...$sessionStates.get()['runtime-a'],
      model: 'catalog-a',
      provider: 'aino',
      platformModel: {
        modelId: 'catalog-a',
        ownerUserId: 'user-a',
        platformOrigin: 'http://127.0.0.1:7001',
        status: 'ready'
      }
    }
  })
  const client = new QueryClient()

  const { result } = renderHook(() =>
    useModelControls({
      queryClient: client,
      cacheOwnerConnectionId: 'connection-b',
      cacheProfile: 'profile-b',
      requestGateway: request as never
    })
  )

  request.mockResolvedValueOnce({ confirm_required: true, confirm_message: 'Switch model?' })
  await act(async () =>
    expect(await result.current.selectModel({ provider: 'aino', model: 'catalog-b', sessionId: 'runtime-b' })).toBe(
      false
    )
  )
  expect($confirmRequest.get()).not.toBeNull()
  const pending = deferred<{ ok: boolean }>()
  bind.mockReturnValueOnce(pending.promise)
  await act(async () => settleConfirm(true))
  await waitFor(() => expect(bind).toHaveBeenCalledOnce())
  $activeGatewayProfile.set('profile-c')
  setCurrentProvider('custom:c')
  setCurrentModel('model-c')
  backend.model_status = 'ready'
  pending.resolve({ ok: true })
  await waitFor(() => expect($sessionStates.get()['runtime-b'].platformModel?.status).toBe('ready'))
  expect(bind).toHaveBeenCalledWith(
    expect.objectContaining({
      connection_id: 'connection-b',
      profile: 'profile-b',
      session_id: 'runtime-b',
      model_id: 'catalog-b'
    })
  )
  expect($sessionStates.get()['runtime-b'].platformModel).toMatchObject({ modelId: 'catalog-b', status: 'ready' })
  expect(client.getQueryData(modelOptionsQueryKey('profile-b', 'runtime-b', 'connection-b'))).toMatchObject({
    provider: 'aino',
    model: 'catalog-b'
  })
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:c', 'model-c'])
})
