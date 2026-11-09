import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { $customModels } from '@/store/custom-models'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog } from '@/store/platform-models'
import { $collapsedProviders, toggleCollapsedProvider } from '@/store/provider-collapse'
import {
  $activeSessionId,
  $currentModel,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $currentProvider,
  $currentReasoningEffort,
  setCurrentModelSource
} from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import { deferred } from '@/test/deferred'
import { stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { ModelMenuCloseContext, ModelMenuPanel } from './model-menu-panel'
import { ReasoningMenuPanel } from './reasoning-menu-panel'

// Radix calls these on open; jsdom doesn't implement them.
beforeAll(() => {
  stubResizeObserver()
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const getGlobalModelOptions = vi.fn()

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: (...args: unknown[]) => getGlobalModelOptions(...args),
  setApiRequestProfile: vi.fn()
}))

// MoA presets now arrive as the catalog's virtual `moa` provider row (the same
// payload a remote gateway's model.options returns), not the /api/model/moa
// REST config.
const MOA_PROVIDER = { models: ['default', 'BeastMode'], name: 'Mixture of Agents', slug: 'moa' }

const DEEPSEEK_PROVIDER = {
  models: ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  name: 'DeepSeek',
  slug: 'deepseek'
}

const GOOGLE_PROVIDER = {
  models: ['gemini-3.1-pro', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  name: 'Google',
  slug: 'google'
}

const MOCK_PROVIDERS = [DEEPSEEK_PROVIDER, GOOGLE_PROVIDER, MOA_PROVIDER]

beforeEach(() => {
  $activeSessionId.set('runtime-1')
  $currentModel.set('')
  $currentProvider.set('')
  $collapsedProviders.set([])
  $customModels.set([])
  getGlobalModelOptions.mockResolvedValue({ providers: MOCK_PROVIDERS })
})

afterEach(() => {
  cleanup()
  $sessionStates.set({})
  $currentPlatformOrigin.set('')
  clearGatewayManagedCapabilities()
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.clearAllMocks()
})

it('searches built-in and custom models together while previewing without a switch', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  recordGatewayReadyCapability({ profile: 'default' }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  const select = vi.fn()
  renderPanel(select)

  await screen.findByText('Fixture Model', { selector: '.aino-model-menu-name' })
  const custom = await screen.findByText(/Gemini 3\.1 Pro/i)
  fireEvent.pointerMove(custom.closest('[role="menuitem"]')!, { pointerType: 'mouse' })
  expect(select).not.toHaveBeenCalled()
  expect(screen.getByRole('complementary', { name: /model details/i }).textContent).toMatch(/Gemini 3\.1 Pro/i)
  const input = screen.getByRole('textbox', { name: 'Search models' })
  expect(screen.getAllByRole('textbox')).toHaveLength(1)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.pointerMove(custom.closest('[role="menuitem"]')!, { pointerType: 'mouse' })
  expect(screen.getByRole('complementary', { name: /model details/i }).textContent).toMatch(/Gemini 3\.1 Pro/i)
  fireEvent.change(input, { target: { value: 'fixture' } })
  expect(screen.queryByText(/Gemini 3\.1 Pro/i, { selector: '[data-model-menu-name]' })).toBeNull()
  expect(screen.getByText('Fixture Model', { selector: '.aino-model-menu-name' })).toBeDefined()
  fireEvent.keyDown(input, { key: 'Enter' })
  await vi.waitFor(() =>
    expect(select).toHaveBeenCalledWith({ model: 'catalog-a', provider: 'aino', sessionId: 'runtime-1' })
  )
})

it('opens custom model details from the keyboard without selecting that model', async () => {
  const select = vi.fn()
  const { content } = renderPanel(select)
  const row = (await content.findByText(/Gemini 3\.1 Pro/i)).closest('[role="menuitem"]')!
  const inspect = within(row as HTMLElement).getByRole('button')
  fireEvent.keyDown(inspect, { key: 'Enter' })
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(inspect)
  expect(screen.getByRole('complementary', { name: 'Model details' }).textContent).toMatch(/Gemini 3\.1 Pro/i)
  expect(select).not.toHaveBeenCalled()
})

it('hides unconfigured providers and their remembered custom models from search', async () => {
  getGlobalModelOptions.mockResolvedValue({
    providers: [
      { ...GOOGLE_PROVIDER, authenticated: false },
      { ...DEEPSEEK_PROVIDER, authenticated: true },
      { models: ['local-test'], name: 'Local endpoint', slug: 'custom:local', is_user_defined: true }
    ]
  })
  $customModels.set([{ provider: 'google', model: 'remembered-custom-model' }])
  const { content } = renderPanel()

  await content.findByText('DeepSeek Chat')
  expect(content.queryByText('Google', { exact: true })).toBeNull()
  expect(content.queryByText(/Gemini 3\.1 Pro/i)).toBeNull()
  expect(content.getByText(/local.?test/i)).toBeDefined()
  const input = screen.getByRole('textbox', { name: 'Search models' })
  fireEvent.change(input, { target: { value: 'remembered-custom-model' } })
  expect(content.queryByText('Google', { exact: true })).toBeNull()
  expect(content.queryByRole('menuitem', { name: /remembered-custom-model.*Google/ })).toBeNull()
  expect(content.getByRole('menuitem', { name: 'Configure custom models' })).toBeDefined()
})

it('lists Aino models once when the managed catalog also has a provider row', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  getGlobalModelOptions.mockResolvedValue({
    providers: [{ models: ['catalog-a'], name: 'Aino', slug: 'aino' }, DEEPSEEK_PROVIDER]
  })
  recordGatewayReadyCapability({ profile: 'default' }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  const { content } = renderPanel()

  await content.findByText('Fixture Model', { selector: '.aino-model-menu-name' })
  await content.findByText('DeepSeek Chat')
  expect(content.queryByText('Aino', { selector: '.group\\/label span', exact: true })).toBeNull()
  expect(content.queryByText('Catalog A', { selector: '[data-model-menu-name]' })).toBeNull()
})

it.each(['rejected', 'pending'] as const)(
  'refreshes restored Aino models independently of a %s runtime catalog refresh',
  async runtimeStatus => {
    const walletModel = { ...platformModel('wallet'), display_name: 'Wallet model' }
    const restoredModel = { ...platformModel('restored'), display_name: 'Restored subscription model' }
    const list = vi.fn(async () => [walletModel])

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: {
          status: async () => platformSnapshot(),
          capabilities: async () => ({}),
          onChanged: () => () => undefined
        },
        platformModels: {
          list,
          owner: async () => ({ user_id: 'user-a', platform_origin: 'https://fixture.test' })
        }
      }
    })
    await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    $currentProvider.set('aino')
    $currentModel.set('wallet')
    const { content, onSelectModel } = renderPanel()
    await content.findByText('Wallet model', { selector: '.aino-model-menu-name' })
    await content.findByText('DeepSeek Chat')
    list.mockResolvedValue([walletModel, restoredModel])
    const runtimeRefresh = deferred<{ providers: typeof MOCK_PROVIDERS }>()
    getGlobalModelOptions.mockImplementationOnce(() => runtimeRefresh.promise)

    try {
      fireEvent.click(content.getByRole('menuitem', { name: 'Refresh models' }))

      if (runtimeStatus === 'rejected') {
        await act(async () => runtimeRefresh.reject(new Error('runtime catalog unavailable')))
      }

      await content.findByText('Restored subscription model', { selector: '.aino-model-menu-name' })
      expect(list).toHaveBeenCalledTimes(2)
      expect(onSelectModel).not.toHaveBeenCalled()
      expect($currentModel.get()).toBe('wallet')
      expect($currentProvider.get()).toBe('aino')
    } finally {
      await act(async () => runtimeRefresh.resolve({ providers: MOCK_PROVIDERS }))
    }
  }
)

it('keeps the current provider recovery row when its saved credential is unavailable', async () => {
  $currentProvider.set('google')
  $currentModel.set('gemini-3.1-pro')
  getGlobalModelOptions.mockResolvedValue({
    providers: [
      { ...GOOGLE_PROVIDER, models: [], authenticated: false, source: 'configured-current' },
      DEEPSEEK_PROVIDER
    ]
  })
  const { content } = renderPanel()

  const currentRow = (await content.findByText(/Gemini 3\.1 Pro/i)).closest('[role="menuitem"]')
  expect(currentRow?.querySelector('.codicon-check')).not.toBeNull()
  expect(content.queryByText('Google', { exact: true })).toBeNull()
})

it('uses exact ready evidence for Aino without disabling the dropdown custom catalog', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  recordGatewayReadyCapability({ profile: 'default' }, { type: 'gateway.ready', payload: {} })
  const select = vi.fn()
  renderPanel(select)

  expect(screen.getByRole('status').textContent).toContain('does not support Aino models')
  fireEvent.click(await screen.findByText(/Gemini 3\.1 Pro/i))
  expect(select).toHaveBeenCalledWith({ model: 'gemini-3.1-pro', provider: 'google', sessionId: 'runtime-1' })
})

it('leaves non-reasoning cleanup to the shared managed selection path', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  recordGatewayReadyCapability({ profile: 'default' }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  $currentProvider.set('aino')
  $currentModel.set('catalog-a')
  $currentPlatformOwner.set('user-a')
  $currentReasoningEffort.set('high')
  const select = vi.fn(async () => true)
  const { content, requestGateway } = renderPanel(select)

  await act(async () => {
    fireEvent.click(await content.findByRole('menuitem', { name: /Fixture Model/ }))
  })

  expect($currentReasoningEffort.get()).toBe('high')
  expect(requestGateway).not.toHaveBeenCalledWith('config.set', expect.anything())
})

it('exposes the existing live reasoning controls for a verified reasoning-capable Aino model', async () => {
  const origin = 'http://127.0.0.1:7001'
  const reasoningModel = { ...platformModel(), capabilities: { ...platformModel().capabilities, reasoning: true } }
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: {
        list: async () => [reasoningModel],
        owner: async () => ({ user_id: 'user-a', platform_origin: origin })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  recordGatewayReadyCapability({ profile: 'default' }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  $currentProvider.set('aino')
  $currentModel.set('catalog-a')
  $currentPlatformOwner.set('user-a')
  $currentPlatformOrigin.set(origin)
  const { requestGateway } = renderPanel()

  const options = await screen.findByRole('menuitem', { name: /Effort/ })
  expect(options.getAttribute('aria-disabled')).not.toBe('true')
  fireEvent.keyDown(options, { key: 'ArrowRight' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'High' }))
  await vi.waitFor(() => expect(requestGateway).toHaveBeenCalledWith('config.set', expect.anything()))
})

it('opens details on a narrow surface and returns to the model list with Escape', async () => {
  const width = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })

  try {
    const select = vi.fn()
    const { content } = renderPanel(select)
    const row = (await content.findByText(/Gemini 3\.1 Pro/i)).closest('[role="menuitem"]')!
    fireEvent.click(within(row as HTMLElement).getByRole('button'))
    const detail = screen.getByRole('complementary', { name: 'Model details' })
    expect(detail.parentElement?.getAttribute('data-detail-open')).toBe('true')
    expect(select).not.toHaveBeenCalled()
    fireEvent.keyDown(detail, { key: 'Escape' })
    expect(detail.parentElement?.hasAttribute('data-detail-open')).toBe(false)
    const input = screen.getByRole('textbox', { name: 'Search models' })
    expect(input).toBe(input.ownerDocument.activeElement)
    expect(select).not.toHaveBeenCalled()
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  }
})

it.each([false, true])('uses verified Aino capability for the direct reasoning menu: %s', async reasoning => {
  const origin = 'http://127.0.0.1:7001'
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: {
        list: async () => [{ ...platformModel(), capabilities: { ...platformModel().capabilities, reasoning } }],
        owner: async () => ({ user_id: 'user-a', platform_origin: origin })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  $currentProvider.set('aino')
  $currentModel.set('catalog-a')
  $currentPlatformOwner.set('user-a')
  $currentPlatformOrigin.set(origin)
  getGlobalModelOptions.mockResolvedValue({ providers: [] })

  renderPanel(vi.fn(), vi.fn(), ReasoningMenuPanel)

  expect(screen.queryAllByRole('menuitemradio').length > 0).toBe(reasoning)
})

it.each(['different-user', 'different-origin'])(
  'keeps Aino detail options disabled for a session from %s',
  async mismatch => {
    const origin = 'http://127.0.0.1:7001'
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: {
          status: async () => platformSnapshot(),
          capabilities: async () => ({}),
          onChanged: () => () => undefined
        },
        platformModels: {
          list: async () => [
            { ...platformModel(), capabilities: { ...platformModel().capabilities, reasoning: true } }
          ],
          owner: async () => ({ user_id: 'user-a', platform_origin: origin })
        }
      }
    })
    await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
    await platformModelCatalog().load()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    $currentProvider.set('aino')
    $currentModel.set('catalog-a')
    $currentPlatformOwner.set(mismatch === 'different-user' ? 'old-user' : 'user-a')
    $currentPlatformOrigin.set(mismatch === 'different-origin' ? 'https://old.example' : origin)
    const { requestGateway } = renderPanel()

    const options = await screen.findByRole('menuitem', { name: /Effort/ })
    expect(options.getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(options, { key: 'ArrowRight' })
    expect(screen.queryByRole('menuitemradio', { name: 'High' })).toBeNull()
    expect(requestGateway).not.toHaveBeenCalledWith('config.set', expect.anything())
  }
)

function renderPanel(onSelectModel = vi.fn(), onClose = vi.fn(), Panel = ModelMenuPanel) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const requestGateway = vi.fn(async (method: string) => {
    if (method === 'model.options') {
      return getGlobalModelOptions()
    }

    if (method === 'config.set') {
      return {}
    }

    throw new Error(`unexpected gateway method: ${method}`)
  })

  const content = render(
    <QueryClientProvider client={client}>
      <DropdownMenu open>
        <DropdownMenuContent>
          <ModelMenuCloseContext.Provider value={onClose}>
            <Panel
              onFollowDefaultModel={onClose}
              onSelectModel={onSelectModel}
              requestGateway={requestGateway as never}
            />
          </ModelMenuCloseContext.Provider>
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>
  )

  const list = content.baseElement.querySelector('.aino-model-menu-list')

  return { onSelectModel, content: list ? { ...content, ...within(list as HTMLElement) } : content, requestGateway }
}

it('awaits custom dropdown picks, rejects duplicates and keeps a failed pick open', async () => {
  const pending = deferred<boolean>()
  const select = vi.fn(() => pending.promise)
  const close = vi.fn()
  renderPanel(select, close)
  const row = await screen.findByText(/Gemini 3\.1 Pro/i)
  fireEvent.click(row)
  fireEvent.click(row)
  expect(select).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  await act(async () => pending.resolve(false))
  expect(close).not.toHaveBeenCalled()
})

it('explains and blocks the same managed-to-custom busy rule in the dropdown', async () => {
  $currentProvider.set('aino')
  $currentModel.set('catalog-a')
  $sessionStates.set({ 'runtime-1': { provider: 'aino', model: 'catalog-a', busy: true, messages: [] } } as never)
  const select = vi.fn()
  renderPanel(select)
  const row = (await screen.findByText(/Gemini 3\.1 Pro/i)).closest('[role="menuitem"]')!
  expect(screen.getByRole('status').textContent).toContain('Wait for this chat')
  expect(row.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(row)
  expect(select).not.toHaveBeenCalled()
})

describe('ModelMenuPanel MoA presets', () => {
  it('selecting a MoA preset switches PERSISTENTLY via onSelectModel (not the one-shot dispatch)', async () => {
    const { content, onSelectModel } = renderPanel()

    // moaOptions is async (useQuery) — wait for the preset row to mount.
    const row = await content.findByText('MoA: BeastMode')
    fireEvent.click(row)

    // #54670: must route through the persistent model-switch path
    // i.e. onSelectModel with provider 'moa' (which session-scopes live-session
    // switches), NOT a one-shot command.dispatch that reverts after a turn.
    expect(onSelectModel).toHaveBeenCalledWith({ model: 'BeastMode', provider: 'moa', sessionId: 'runtime-1' })
  })

  it('shows the check on the preset that matches the current moa selection', async () => {
    $currentProvider.set('moa')
    $currentModel.set('BeastMode')
    const { content } = renderPanel()

    const row = await content.findByText('MoA: BeastMode')
    // The check codicon renders as a sibling within the same row item.
    const item = row.closest('[role="menuitem"]') ?? row.parentElement
    expect(item?.querySelector('.codicon-check')).not.toBeNull()
  })

  it('keeps the virtual moa provider out of the main model groups (presets section only)', async () => {
    const { content } = renderPanel()

    await content.findByText('MoA: BeastMode')

    // The provider group header would read "Mixture of Agents"; the presets
    // section header reads "MoA presets". Only the latter should exist.
    // Radix DropdownMenu portals its content to document.body, so assert
    // against the body (not content.container) to see the rendered items.

    // eslint-disable-next-line no-restricted-globals
    expect(document.body.textContent).toContain('MoA presets')
    // eslint-disable-next-line no-restricted-globals
    expect(document.body.textContent).not.toContain('Mixture of Agents')
  })

  it('renders presets from the catalog even before a session exists', async () => {
    $activeSessionId.set('')
    const { onSelectModel, content } = renderPanel()

    const row = await content.findByText('MoA: BeastMode')
    fireEvent.click(row)

    // Pre-session picks are UI state shipped on the next session.create — the
    // row must not be disabled and must still route through onSelectModel.
    expect(onSelectModel).toHaveBeenCalledWith({ model: 'BeastMode', provider: 'moa', sessionId: null })
  })
})

describe('ModelMenuPanel current selection', () => {
  it.each(['runtime-options', 'session-view'] as const)(
    'opens details and checks the same Aino model confirmed by %s',
    async source => {
      const models = [
        { ...platformModel('model-gpt'), display_name: 'GPT model' },
        { ...platformModel('model-glm'), display_name: 'GLM model' }
      ]

      Object.defineProperty(window, 'hermesDesktop', {
        configurable: true,
        value: {
          platformAccount: {
            status: async () => platformSnapshot(),
            capabilities: async () => ({}),
            onChanged: () => () => undefined
          },
          platformModels: { list: async () => models }
        }
      })
      await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
      recordGatewayReadyCapability(
        { profile: 'default' },
        { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
      )
      getGlobalModelOptions.mockResolvedValue({
        model: 'model-glm',
        provider: 'aino',
        providers: MOCK_PROVIDERS
      })

      if (source === 'session-view') {
        // A manually selected live model wins over an older runtime catalog.
        $currentModel.set('model-gpt')
        $currentProvider.set('aino')
      }

      const { content, onSelectModel } = renderPanel()
      await content.findByText('GLM model', { selector: '.aino-model-menu-name' })
      const currentLabel = source === 'session-view' ? 'GPT model' : 'GLM model'
      const currentId = source === 'session-view' ? 'model-gpt' : 'model-glm'

      await vi.waitFor(() => {
        const details = screen.getByRole('complementary', { name: 'Model details' })
        expect(within(details).getByText(currentLabel)).toBeDefined()
        expect(within(details).getByText('In use')).toBeDefined()
        expect(
          content
            .getByText(currentLabel, { selector: '.aino-model-menu-name' })
            .closest('[role="menuitem"]')
            ?.getAttribute('aria-current')
        ).toBe('true')
      })
      expect(content.baseElement.querySelectorAll('[data-platform-model-id][aria-current="true"]')).toHaveLength(1)
      expect(content.baseElement.querySelector('[aria-current="true"]')?.getAttribute('data-platform-model-id')).toBe(
        currentId
      )
      expect(onSelectModel).not.toHaveBeenCalled()
      expect($currentModel.get()).toBe(source === 'session-view' ? 'model-gpt' : '')
    }
  )

  it('keeps the checkmark on the live SessionView model when a stale options response disagrees', async () => {
    $currentProvider.set('google')
    $currentModel.set('gemini-3.1-pro')
    getGlobalModelOptions.mockResolvedValue({
      model: 'deepseek-chat',
      provider: 'deepseek',
      providers: MOCK_PROVIDERS
    })

    const { content } = renderPanel()

    const currentRow = (await content.findByText(/Gemini 3\.1 Pro/i)).closest('[role="menuitem"]')
    const staleRow = content.getByText('DeepSeek Chat').closest('[role="menuitem"]')

    expect(currentRow?.querySelector('.codicon-check')).not.toBeNull()
    expect(staleRow?.querySelector('.codicon-check')).toBeNull()
  })
})

describe('ModelMenuPanel search', () => {
  // The pinned current model must NOT ride along on a query it doesn't match:
  // it reads like the top result, so Enter/click picks the wrong model (the
  // "type grok, get fable" bug). Every surveyed picker (VS Code, Zed, Open
  // WebUI, Cherry Studio) drops the pin while filtering.
  // Highlighted labels are split across <mark> nodes, so single-text-node
  // queries miss them — match on the row span's composed textContent. Badge
  // chips (#51833) live in a wrapper span around the name, so require a leaf
  // span: the wrapper's composed textContent matches too.
  const rowWithText = (content: ReturnType<typeof renderPanel>['content'], pattern: RegExp) =>
    content.queryByText(
      (_, element) =>
        element?.tagName === 'SPAN' && !element.querySelector('span') && pattern.test(element.textContent ?? '')
    )

  it('hides the non-matching current model while a query is active', async () => {
    $currentProvider.set('deepseek')
    $currentModel.set('deepseek-v4-pro')
    const { content } = renderPanel()

    await content.findByText(/DeepSeek V4 Pro/i)

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'gemini' } })

    await vi.waitFor(() => {
      expect(rowWithText(content, /Gemini 3\.1 Pro/i)).not.toBeNull()
    })
    expect(rowWithText(content, /DeepSeek V4 Pro/i)).toBeNull()
  })

  it('Enter in the search field commits the first match', async () => {
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'gemini' } })

    await vi.waitFor(() => {
      expect(rowWithText(content, /Gemini 3\.1 Pro/i)).not.toBeNull()
    })

    fireEvent.keyDown(input, { key: 'Enter' })

    // First matching family of the first (alphabetical) matching provider.
    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'gemini-3.1-pro',
        provider: 'google',
        sessionId: 'runtime-1'
      })
    })
  })

  it('Enter on an id nothing lists selects it as a custom model', async () => {
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'zzz-no-such-model' } })

    // One row per configured provider (MoA excluded).
    await vi.waitFor(() => {
      expect(content.getAllByText(/^zzz-no-such-model/)).toHaveLength(2)
    })

    fireEvent.keyDown(input, { key: 'Enter' })

    // First configured provider, since no provider is current.
    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'zzz-no-such-model',
        provider: 'deepseek',
        sessionId: 'runtime-1'
      })
    })
  })

  it('a query that still matches catalog rows offers no custom model', async () => {
    const { content } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'gemini' } })

    await vi.waitFor(() => {
      expect(rowWithText(content, /Gemini 3\.1 Pro/i)).not.toBeNull()
    })
    expect(rowWithText(content, /^gemini$/)).toBeNull()
  })

  it('arrows move the selection without leaving the input; Enter commits the stepped row', async () => {
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'gemini' } })

    await vi.waitFor(() => {
      expect(rowWithText(content, /Gemini 3\.1 Pro/i)).not.toBeNull()
    })

    // First match auto-selected; ↓ steps to the second match.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        provider: 'google',
        sessionId: 'runtime-1'
      })
    })
  })

  it('keeps model rows hit-testable before any pointer movement (#123040)', async () => {
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const row = rowWithText(content, /Gemini 3\.1 Pro/i)!.closest('[role="menuitem"]')!

    // CSS hit-testing is the regression boundary: the previous catalog put a
    // pointer-events-none ancestor around every row until mousemove/wheel.
    expect(row.closest('.pointer-events-none')).toBeNull()

    fireEvent.click(row)

    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'gemini-3.1-pro',
        provider: 'google',
        sessionId: 'runtime-1'
      })
    })
  })

  it('hovering a model row leaves focus in the search field and arrows still drive the list (#53980)', async () => {
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    input.focus()
    fireEvent.change(input, { target: { value: 'gemini' } })

    await vi.waitFor(() => {
      expect(rowWithText(content, /Gemini 2\.5 Pro/i)).not.toBeNull()
    })

    // No wake event is needed: DropdownMenu's search-safe hover suppresses
    // Radix focus theft directly while leaving deliberate clicks enabled.
    fireEvent.pointerMove(rowWithText(content, /Gemini 2\.5 Pro/i)!, { pointerType: 'mouse' })

    expect(input.ownerDocument.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        provider: 'google',
        sessionId: 'runtime-1'
      })
    })
  })

  it('with no query the selection sits on the current model, so Enter closes without switching', async () => {
    $currentProvider.set('google')
    $currentModel.set('gemini-3.1-pro')
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelectModel).not.toHaveBeenCalled()
  })

  it('filters MoA presets by the query instead of leaving them as phantom first matches', async () => {
    const { content, onSelectModel } = renderPanel()

    await content.findByText('MoA: BeastMode')

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'beast' } })

    await vi.waitFor(() => {
      expect(rowWithText(content, /MoA: BeastMode/)).not.toBeNull()
    })
    expect(rowWithText(content, /MoA: default/)).toBeNull()

    // The surviving preset IS the first row, so Enter commits it.
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({ model: 'BeastMode', provider: 'moa', sessionId: 'runtime-1' })
    })
  })
})

describe('ModelMenuPanel configured model rows', () => {
  it('shows concrete models without collapsible provider headers', async () => {
    const { content } = renderPanel()

    await content.findByText('DeepSeek Chat')
    expect(content.getByText('DeepSeek V4 Pro')).toBeDefined()
    expect(content.queryByText('DeepSeek', { exact: true })).toBeNull()
    expect(content.queryByText('Google', { exact: true })).toBeNull()
  })

  it('keeps the active model visible despite saved provider collapse preferences', async () => {
    $currentProvider.set('deepseek')
    $currentModel.set('deepseek-v4-pro')
    $collapsedProviders.set(['deepseek'])
    const { content, onSelectModel } = renderPanel()

    const row = (await content.findByText('DeepSeek V4 Pro')).closest('[role="menuitem"]')!
    expect(row.querySelector('.codicon-check')).not.toBeNull()
    expect(content.getByText('DeepSeek Chat')).toBeDefined()
    expect($collapsedProviders.get()).toEqual(['deepseek'])
    fireEvent.click(row)
    expect(onSelectModel).not.toHaveBeenCalled()
  })

  it('filters the visible model rows without restoring provider headers', async () => {
    $collapsedProviders.set(['deepseek'])
    const { content } = renderPanel()

    await content.findByText('DeepSeek Chat')
    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.change(input, { target: { value: 'deepseek' } })

    await content.findByRole('menuitem', { name: /DeepSeek V4 Pro/i })
    expect(content.queryByRole('menuitem', { name: /Gemini 3\.1 Pro/i })).toBeNull()
    expect(content.queryByRole('menuitem', { name: /^DeepSeek$/ })).toBeNull()
  })

  it('uses the visible rows for keyboard selection despite saved provider collapse preferences', async () => {
    $collapsedProviders.set(['deepseek'])
    const { content, onSelectModel } = renderPanel()

    await content.findByText('DeepSeek Chat')
    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await vi.waitFor(() => {
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'deepseek-v4-pro',
        provider: 'deepseek',
        sessionId: 'runtime-1'
      })
    })
  })

  // The collapsed-providers set is a global presentation preference
  // (`hermes.desktop.collapsed-providers`), but the catalog the picker renders
  // is profile-scoped (`getGlobalModelOptions` routes through
  // `profileScoped()`). Pruning the global set against only the active catalog
  // would silently delete a user's collapse preference on every profile switch
  // whose configured providers don't include the slug — the bug the maintainer
  // flagged. The set must survive catalog changes; if the same provider shows
  // up again later, the previous collapse is preserved.
  it('preserves the collapsed set across a profile switch whose catalog lacks the slug', async () => {
    toggleCollapsedProvider('deepseek')
    toggleCollapsedProvider('google')
    expect($collapsedProviders.get()).toEqual(['deepseek', 'google'])

    // Profile A: both providers present, render + unmount.
    getGlobalModelOptions.mockResolvedValueOnce({ providers: MOCK_PROVIDERS })
    const a = renderPanel()
    await a.content.findByText('DeepSeek Chat')
    a.content.unmount()

    // Profile B: google is not in the catalog (simulates a profile whose
    // configured providers differ). The previously-collapsed 'google' slug
    // must survive — pruning it would lose state across a profile switch.
    getGlobalModelOptions.mockResolvedValueOnce({ providers: [DEEPSEEK_PROVIDER, MOA_PROVIDER] })
    const b = renderPanel()
    await b.content.findByText('DeepSeek Chat')

    expect($collapsedProviders.get()).toEqual(['deepseek', 'google'])
  })

  it('preserves the collapsed set when Refresh Models drops a provider', async () => {
    toggleCollapsedProvider('deepseek')
    toggleCollapsedProvider('google')

    // First load: both providers present.
    getGlobalModelOptions.mockResolvedValueOnce({ providers: MOCK_PROVIDERS })
    const a = renderPanel()
    await a.content.findByText('DeepSeek Chat')
    a.content.unmount()

    // Refresh Models returns a catalog that drops google (revoked key,
    // plugin disabled, backend policy change). 'google' must survive — the
    // user explicitly collapsed it, and the global set is not tied to any
    // single refresh.
    getGlobalModelOptions.mockResolvedValueOnce({ providers: [DEEPSEEK_PROVIDER, MOA_PROVIDER] })
    const b = renderPanel()
    await b.content.findByText('DeepSeek Chat')

    expect($collapsedProviders.get()).toContain('google')
    expect($collapsedProviders.get()).toContain('deepseek')
  })

  it('keeps the current pick when Refresh Models no longer lists it', async () => {
    // Rows are hints (discovered / curated / capped); a custom slug the row
    // lacks is still what the user selected. Only the gateway may reject it.
    $currentProvider.set('zhipu')
    $currentModel.set('glm-4.5-air')
    getGlobalModelOptions
      .mockResolvedValueOnce({
        model: 'glm-4.5-air',
        provider: 'zhipu',
        providers: [{ models: ['glm-4.5-air', 'glm-5-turbo'], name: '智谱2', slug: 'zhipu' }, MOA_PROVIDER]
      })
      .mockResolvedValueOnce({
        model: 'glm-4.5-air',
        provider: 'zhipu',
        providers: [DEEPSEEK_PROVIDER, MOA_PROVIDER]
      })

    const { content, onSelectModel } = renderPanel()

    await content.findByText(/GLM 4.5 Air/i)

    fireEvent.click(await content.findByRole('menuitem', { name: 'Refresh models' }))

    await vi.waitFor(() => {
      expect(getGlobalModelOptions).toHaveBeenCalledTimes(2)
    })
    expect(onSelectModel).not.toHaveBeenCalled()
    expect($currentModel.get()).toBe('glm-4.5-air')
    expect($currentProvider.get()).toBe('zhipu')
  })

  it('does not rewrite the provider when Refresh Models lists the same model id elsewhere', async () => {
    $currentProvider.set('zhipu')
    $currentModel.set('glm-4.5-air')

    const catalog = {
      model: 'glm-4.5-air',
      provider: 'zhipu',
      providers: [
        { models: ['glm-4.5-air', 'gpt-5.5'], name: 'OpenRouter', slug: 'openrouter' },
        { models: ['glm-4.5-air', 'glm-5-turbo'], name: '智谱2', slug: 'zhipu' },
        MOA_PROVIDER
      ]
    }

    getGlobalModelOptions.mockResolvedValue(catalog)

    const { content, onSelectModel } = renderPanel()

    await content.findAllByText(/GLM 4.5 Air/i)
    fireEvent.click(await content.findByRole('menuitem', { name: 'Refresh models' }))

    await vi.waitFor(() => {
      expect(getGlobalModelOptions).toHaveBeenCalledTimes(2)
    })
    expect(onSelectModel).not.toHaveBeenCalled()
  })

  it('marks only the matching provider row current when two providers share a model id', async () => {
    $currentProvider.set('zhipu')
    $currentModel.set('glm-4.5-air')
    getGlobalModelOptions.mockResolvedValue({
      model: 'glm-4.5-air',
      provider: 'zhipu',
      providers: [
        { models: ['glm-4.5-air', 'gpt-5.5'], name: 'OpenRouter', slug: 'openrouter' },
        { models: ['glm-4.5-air', 'glm-5-turbo'], name: '智谱2', slug: 'zhipu' },
        MOA_PROVIDER
      ]
    })

    const { content, onSelectModel } = renderPanel()

    const rows = await content.findAllByText(/GLM 4.5 Air/i)
    const items = [...new Set(rows.map(row => row.closest('[role="menuitem"]')))]

    expect(items).toHaveLength(2)

    const checked = items.filter(item => item?.querySelector('.codicon-check'))
    expect(checked).toHaveLength(1)
    fireEvent.pointerMove(checked[0]!, { pointerType: 'mouse' })
    expect(within(screen.getByRole('complementary')).getByText('智谱2')).toBeDefined()

    const other = items.find(item => !item?.querySelector('.codicon-check'))!
    fireEvent.pointerMove(other, { pointerType: 'mouse' })
    expect(within(screen.getByRole('complementary')).getByText('OpenRouter')).toBeDefined()

    const input = screen.getByRole('textbox', { name: 'Search models' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectModel).not.toHaveBeenCalled()
    fireEvent.click(other)
    await vi.waitFor(() =>
      expect(onSelectModel).toHaveBeenCalledWith({
        model: 'glm-4.5-air',
        provider: 'openrouter',
        sessionId: 'runtime-1'
      })
    )
  })
})

describe('ModelMenuPanel pinned draft', () => {
  afterEach(() => setCurrentModelSource(''))

  it('offers the way back to the Settings default only while a draft carries a manual pick (#107410)', async () => {
    $activeSessionId.set(null)
    setCurrentModelSource('manual')
    const onFollowDefaultModel = vi.fn()
    const { content } = renderPanel(vi.fn(), onFollowDefaultModel)

    fireEvent.click(await content.findByText('Use Settings default'))
    expect(onFollowDefaultModel).toHaveBeenCalledTimes(1)
    cleanup()

    setCurrentModelSource('default')
    const unpinned = renderPanel(vi.fn(), vi.fn())
    await unpinned.content.findByRole('menuitem', { name: 'Refresh models' })
    expect(unpinned.content.queryByText('Use Settings default')).toBeNull()
    cleanup()

    // A live session runs its own model; the pin only decides the NEXT new chat.
    $activeSessionId.set('runtime-1')
    setCurrentModelSource('manual')
    const live = renderPanel(vi.fn(), vi.fn())
    await live.content.findByRole('menuitem', { name: 'Refresh models' })
    expect(live.content.queryByText('Use Settings default')).toBeNull()
  })
})
