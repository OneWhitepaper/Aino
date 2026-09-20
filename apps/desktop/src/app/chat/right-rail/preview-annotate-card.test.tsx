import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ANNOTATE_CARD_WIDTH } from '@/lib/preview-annotate'

import { placeAnnotateCard, PreviewAnnotateCard } from './preview-annotate-card'

afterEach(cleanup)

describe('placeAnnotateCard', () => {
  it('sits to the right of the pin instead of past a full-width selection', () => {
    const placed = placeAnnotateCard({
      paneHeight: 640,
      paneWidth: 420,
      rect: { height: 220, width: 400, x: 8, y: 48 }
    })

    expect(placed.left).toBeLessThan(80)
    expect(placed.left).toBeGreaterThan(12)
    expect(placed.top).toBeGreaterThanOrEqual(12)
  })

  it('stays inside the pane when the pin is on the right edge', () => {
    const placed = placeAnnotateCard({
      paneHeight: 400,
      paneWidth: 360,
      rect: { height: 40, width: 80, x: 300, y: 20 }
    })

    expect(placed.left + ANNOTATE_CARD_WIDTH).toBeLessThanOrEqual(360)
    expect(placed.left).toBeGreaterThanOrEqual(12)
    expect(placed.top).toBeGreaterThanOrEqual(12)
  })
})

describe('PreviewAnnotateCard', () => {
  it('inherits host appearance while keeping comment editing, save and cancel available', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const onChange = vi.fn()

    const rendered = render(
      <PreviewAnnotateCard
        left={24}
        note=""
        number={3}
        onCancel={onCancel}
        onChange={onChange}
        onSave={onSave}
        placeholder="Add a comment..."
        saveLabel="Save"
        title="Comment 3"
        top={40}
      />
    )

    const input = rendered.getByPlaceholderText('Add a comment...') as HTMLInputElement
    expect(input.style.colorScheme).toBe('')
    expect(input.ownerDocument.activeElement).toBe(input)
    expect(rendered.container.querySelector('.codicon-mic')).toBeNull()
    expect(rendered.container.querySelector('.codicon-unmute')).toBeNull()

    fireEvent.click(rendered.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledOnce()
    fireEvent.change(input, { target: { value: 'Use a clearer heading' } })
    expect(onChange).toHaveBeenCalledWith('Use a clearer heading')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
