import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { PaneStripGlyph } from './pane-tab'
import { RootTooltipProvider, Tip } from './tooltip'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function hoverGlyph(browserToolbar: boolean) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-tree-group')) {
      return new DOMRect(280, 90, 600, 600)
    }

    return this.tagName === 'BUTTON'
      ? new DOMRect(300, 100, 24, 24)
      : new DOMRect(0, 0, 1024, 768)
  })

  for (const [name, size] of [['clientWidth', 1024], ['clientHeight', 768]] as const) {
    vi.spyOn(Element.prototype, name, 'get').mockReturnValue(size)
  }

  render(
    <RootTooltipProvider>
      <div data-tree-group="browser">
        <div data-preview-toolbar={browserToolbar ? '' : undefined}>
          <PaneStripGlyph icon={<span />} label="Annotate page" onSelect={() => {}} />
          <Tip label="Saved logins" placement="toolbar"><button>Vault</button></Tip>
        </div>
      </div>
    </RootTooltipProvider>
  )
  const trigger = screen.getByRole('button', { name: 'Annotate page' })
  fireEvent.pointerEnter(trigger)
  fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
  // eslint-disable-next-line no-restricted-globals -- tooltip content is portaled outside the rendered container
  await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull())

  // eslint-disable-next-line no-restricted-globals -- read the actual positioned tooltip
  return document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!
}

it('keeps browser toolbar labels above the page rather than covering the native guest', async () => {
  const bubble = await hoverGlyph(true)
  await waitFor(() => expect(bubble.dataset.side).toBe('top'))
})

it('preserves the normal placement of other pane toolbars', async () => {
  const bubble = await hoverGlyph(false)
  await waitFor(() => expect(bubble.dataset.side).toBe('bottom'))
})
