import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ImageGenerationSettings } from './image-generation-settings'

vi.mock('./toolset-config-panel', () => ({
  ToolsetConfigPanel: ({ profile, toolset }: { profile: string; toolset: string }) => (
    <div data-testid="image-config">
      {profile}:{toolset}
    </div>
  )
}))
afterEach(cleanup)

it('keeps image provider configuration collapsed until asked and forwards the settings profile', () => {
  render(<ImageGenerationSettings profile="writer" />)
  const disclosure = screen.getByRole('button', { name: 'Image generation' })
  expect(disclosure.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByTestId('image-config')).toBeNull()
  fireEvent.click(disclosure)
  expect(disclosure.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByTestId('image-config').textContent).toBe('writer:image_gen')
})
