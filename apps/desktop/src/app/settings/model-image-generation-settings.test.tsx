import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ModelImageGenerationSettings } from './model-image-generation-settings'

const scope = vi.hoisted(() => ({ connectionId: 'remote', profile: 'writer' }))
const read = vi.hoisted(() => vi.fn())
vi.mock('../hooks/use-config-record', () => ({
  useHermesConfigRecord: (profile: unknown) => {
    read(profile)

    return { writeScope: scope }
  }
}))
vi.mock('./image-generation-settings', () => ({
  ImageGenerationSettings: ({ profile }: { profile: typeof scope }) => (
    <output aria-label="image-owner">{JSON.stringify(profile)}</output>
  )
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('places the image section before existing trailing content using the same captured config owner', () => {
  render(
    <ModelImageGenerationSettings activeSectionId="model" profile="writer" subpage="main">
      <div>trailing</div>
    </ModelImageGenerationSettings>
  )
  expect(read).toHaveBeenCalledWith('writer')
  expect(screen.getByLabelText('image-owner').textContent).toBe(JSON.stringify(scope))
  expect(screen.getByLabelText('image-owner').nextElementSibling?.textContent).toBe('trailing')
})

it.each([
  ['chat', 'main'],
  ['model', 'auxiliary'],
  ['model', 'moa'],
  ['model', 'fallbacks']
])('does not mount image configuration on %s/%s', (activeSectionId, subpage) => {
  render(
    <ModelImageGenerationSettings activeSectionId={activeSectionId} profile="writer" subpage={subpage}>
      <div>trailing</div>
    </ModelImageGenerationSettings>
  )
  expect(screen.queryByLabelText('image-owner')).toBeNull()
  expect(screen.getByText('trailing')).toBeTruthy()
  expect(read).not.toHaveBeenCalled()
})
