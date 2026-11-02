import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { platformModel } from '@/test/platform-model'

import { AinoImageQuality } from './aino-image-quality'

afterEach(cleanup)

it.each([
  { options: ['auto', 'high'], quality: null, selected: 'Auto' },
  { options: ['auto', 'high'], quality: 'high', selected: 'High' },
  { options: ['low', 'high'], quality: null, selected: 'Model default' }
] as const)(
  'resolves the selected quality without overwriting a saved choice ($selected)',
  ({ options, quality, selected }) => {
    const model = platformModel()
    model.capabilities.image_quality_options = [...options]
    const onChange = vi.fn()

    render(<AinoImageQuality configurable disabled={false} model={model} onChange={onChange} quality={quality} />)
    expect(screen.getByRole('button', { name: selected }).getAttribute('aria-pressed')).toBe('true')

    if (options.some(option => option === 'auto')) {
      expect(screen.queryByRole('button', { name: 'Model default' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
      expect(onChange).toHaveBeenCalledWith('auto')
    }
  }
)

it('lets a stale unsupported quality be cleared even when a model no longer offers quality options', () => {
  const onChange = vi.fn()

  render(<AinoImageQuality configurable disabled={false} model={platformModel()} onChange={onChange} quality="high" />)
  expect(screen.getByRole('alert').textContent).toContain('no longer supported')
  const reset = screen.getByRole('button', { name: 'Model default' })

  expect(reset.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(reset)
  expect(onChange).toHaveBeenCalledWith(null)
})
