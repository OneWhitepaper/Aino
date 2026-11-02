import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { PaneLayer } from './pane-layer'

it('releases focus when a kept pane becomes inactive', () => {
  const view = render(
    <PaneLayer active>
      <input aria-label="Draft" />
    </PaneLayer>
  )

  const input = screen.getByRole('textbox')
  fireEvent.focus(input)
  input.focus()
  expect(input.ownerDocument.activeElement).toBe(input)
  view.rerender(
    <PaneLayer active={false}>
      <input aria-label="Draft" />
    </PaneLayer>
  )
  expect(input.ownerDocument.activeElement).not.toBe(input)
  expect(input.closest('[inert]')).toBeTruthy()
})
