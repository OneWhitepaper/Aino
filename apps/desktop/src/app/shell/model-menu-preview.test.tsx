import type { ModelOptionProvider } from '@hermes/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { $favoriteModels } from '@/store/favorite-models'
import { platformModel } from '@/test/platform-model'

import type { ModelMenuController } from './model-catalog-menu'
import { type ModelMenuPreview, ModelMenuPreviewDetails } from './model-menu-preview'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  $favoriteModels.set([])
})

const provider: ModelOptionProvider = {
  slug: 'lab',
  name: 'Lab',
  models: ['m1', 'm1-fast'],
  capabilities: { m1: { fast: false, reasoning: true } }
}

function renderPreview(preview: ModelMenuPreview, current = { model: 'other', provider: 'lab' }) {
  const controller: ModelMenuController = {
    current: { effort: 'medium', fast: false, ...current },
    presetFor: () => ({}),
    select: vi.fn(),
    applyPreset: vi.fn(),
    setOptions: vi.fn()
  }

  render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <ModelMenuPreviewDetails controller={controller} defaultEffort="medium" onBack={vi.fn()} preview={preview} />
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return controller
}

it('previews an inactive model and records an effort preference without changing the selection', async () => {
  const controller = renderPreview({ kind: 'custom', family: { id: 'm1', fastId: 'm1-fast' }, provider })
  expect(controller.select).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Effort/ }), { key: 'ArrowRight' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'High' }))
  expect(controller.setOptions).toHaveBeenCalledWith(
    { effort: 'high' },
    { isActive: false, model: 'm1', provider: 'lab' }
  )
  expect(controller.select).not.toHaveBeenCalled()
})

it('recognizes the active fast sibling and uses the existing variant switch behavior', async () => {
  const controller = renderPreview(
    { kind: 'custom', family: { id: 'm1', fastId: 'm1-fast' }, provider },
    { model: 'm1-fast', provider: 'lab' }
  )

  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Effort/ }), { key: 'ArrowRight' })
  fireEvent.click(await screen.findByRole('switch', { name: 'Fast' }))
  expect(controller.select).toHaveBeenCalledWith('m1', 'lab')
  expect(controller.setOptions).toHaveBeenCalledWith({ fast: false }, { isActive: true, model: 'm1', provider: 'lab' })
})

it('closes only the options submenu on Escape and leaves model selection open', async () => {
  const onOpenChange = vi.fn()

  const controller: ModelMenuController = {
    current: { effort: 'medium', fast: false, model: 'm1', provider: 'lab' },
    presetFor: () => ({}),
    select: vi.fn(),
    applyPreset: vi.fn(),
    setOptions: vi.fn()
  }

  render(
    <DropdownMenu onOpenChange={onOpenChange} open>
      <DropdownMenuContent>
        <ModelMenuPreviewDetails
          controller={controller}
          defaultEffort="medium"
          onBack={vi.fn()}
          preview={{ kind: 'custom', family: { id: 'm1', fastId: 'm1-fast' }, provider }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /Effort/ }), { key: 'ArrowRight' })
  fireEvent.keyDown(await screen.findByRole('menuitemradio', { name: 'High' }), { key: 'Escape' })
  expect(onOpenChange).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(screen.queryByRole('menuitemradio', { name: 'High' })).toBeNull())
  expect(screen.getByRole('complementary', { name: 'Model details' })).toBeDefined()
})

it('omits unavailable reasoning controls and keeps real Aino pricing accessible', () => {
  const model = platformModel()
  model.pricing.time_pricing = {
    timezone: 'Asia/Shanghai',
    weekdays_only: true,
    periods: [{ start_time: '09:00', end_time: '18:00', multiplier: '1.5' }]
  }
  renderPreview({ kind: 'aino', model })
  expect(screen.queryByRole('menuitem', { name: /Effort/ })).toBeNull()
  expect(screen.getAllByText(/10,000/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('Pricing & capabilities'))
  expect(screen.getByText(/Asia\/Shanghai/)).toBeDefined()
  expect(screen.getByText(/09:00 - 18:00: 1.5x/)).toBeDefined()
})
