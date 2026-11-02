import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { $customModels } from '@/store/custom-models'
import { $favoriteModels } from '@/store/favorite-models'
import { $localModelsEnabled } from '@/store/local-models-flag'
import {
  $customModelConfigTarget,
  $knownModels,
  $visibleModels,
  closeCustomModelConfig,
  modelVisibilityKey
} from '@/store/model-visibility'
import { $collapsedProviders } from '@/store/provider-collapse'

import { ModelCatalogMenu, ModelMenuCloseContext, type ModelMenuController } from './model-catalog-menu'
import { ModelMenuPreviewContext } from './model-menu-preview'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const getGlobalModelOptions = vi.fn()

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: (...args: unknown[]) => getGlobalModelOptions(...args),
  getLocalModelsJobs: vi.fn(async () => ({ jobs: [] })),
  getLocalModelsStatus: vi.fn().mockResolvedValue({ loading: {} }),
  setApiRequestProfile: vi.fn()
}))

beforeEach(() => {
  $collapsedProviders.set(['deepseek'])
  $customModels.set([])
  $favoriteModels.set([])
  $knownModels.set(null)
  $visibleModels.set(null)
  $localModelsEnabled.set(false)
  closeCustomModelConfig()
  getGlobalModelOptions.mockResolvedValue({
    providers: [
      {
        authenticated: true,
        models: ['deepseek-chat', 'deepseek-reasoner'],
        name: 'DeepSeek',
        slug: 'deepseek'
      }
    ]
  })
})

afterEach(() => {
  cleanup()
  closeCustomModelConfig()
  $collapsedProviders.set([])
  $knownModels.set(null)
  $visibleModels.set(null)
  vi.clearAllMocks()
})

interface MenuOptions {
  composer?: boolean
  connectionId?: string
  profile?: string
}

function renderMenu({ composer = true, connectionId = 'remote-work', profile = 'writer' }: MenuOptions = {}) {
  const controller: ModelMenuController = {
    applyPreset: vi.fn(),
    current: { effort: '', fast: false, model: '', provider: '' },
    presetFor: () => ({}),
    select: vi.fn(async () => true),
    setOptions: vi.fn()
  }

  const close = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const content = (
    <ModelMenuCloseContext.Provider value={close}>
      <ModelCatalogMenu controller={controller} ownerConnectionId={connectionId} profile={profile} />
    </ModelMenuCloseContext.Provider>
  )

  render(
    <QueryClientProvider client={client}>
      <DropdownMenu open>
        <DropdownMenuContent>
          {composer ? (
            <ModelMenuPreviewContext.Provider value={{ onInspect: vi.fn(), onPreview: vi.fn() }}>
              {content}
            </ModelMenuPreviewContext.Provider>
          ) : (
            content
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>
  )

  return { close, controller }
}

it('shows concrete configured models in the composer despite a saved provider collapse preference', async () => {
  const { controller } = renderMenu()

  await screen.findByText('DeepSeek Chat')
  expect(screen.getByText('DeepSeek Reasoner')).toBeDefined()
  expect(screen.queryByText('DeepSeek', { exact: true })).toBeNull()

  const search = screen.getByRole('textbox', { name: 'Search models' })
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'Enter' })
  await vi.waitFor(() => expect(controller.select).toHaveBeenCalledWith('deepseek-chat', 'deepseek'))
})

it('keeps the user-curated shortlist while removing provider collapse controls in the composer', async () => {
  const chatKey = modelVisibilityKey('deepseek', 'deepseek-chat')
  const reasonerKey = modelVisibilityKey('deepseek', 'deepseek-reasoner')
  $knownModels.set(new Set([chatKey, reasonerKey]))
  $visibleModels.set(new Set([chatKey]))

  renderMenu()

  await screen.findByText('DeepSeek Chat')
  expect(screen.queryByText('DeepSeek Reasoner')).toBeNull()
  expect(screen.queryByText('DeepSeek', { exact: true })).toBeNull()
})

it.each(['remote-work', 'local'])(
  'opens configuration for the requesting %s connection without selecting a model',
  async connectionId => {
    const { close, controller } = renderMenu({ connectionId, profile: 'writer' })

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Configure custom models' }))

    expect(close).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect($customModelConfigTarget.get()).toEqual({ connectionId, profile: 'writer' }))
    expect(controller.select).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Add custom model…' })).toBeNull()
  }
)

it('retains provider collapse and slug-entry configuration on non-composer pickers', async () => {
  renderMenu({ composer: false })

  await screen.findByText('DeepSeek', { exact: true })
  expect(screen.queryByText('DeepSeek Chat')).toBeNull()
  expect(screen.getByRole('menuitem', { name: 'Edit models…' })).toBeDefined()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add custom model…' }))

  expect(screen.queryByText('DeepSeek', { exact: true })).toBeNull()
  expect($customModelConfigTarget.get()).toBeNull()
  expect(screen.getByRole('textbox').getAttribute('placeholder')).not.toBe('Search models')
})
