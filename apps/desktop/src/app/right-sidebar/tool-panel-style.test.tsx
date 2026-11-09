import { readFileSync } from 'node:fs'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaneTab, PaneTabLabel, PaneTabStrip } from '@/components/ui/pane-tab'

// Vitest stubs CSS modules; load this stylesheet as the browser's style input.
const toolPanelStyles = readFileSync('src/app/right-sidebar/tool-panel.css', 'utf8')

let stylesheet: HTMLStyleElement

beforeEach(() => {
  stylesheet = globalThis.document.createElement('style')
  stylesheet.textContent = toolPanelStyles
  globalThis.document.head.append(stylesheet)
})

afterEach(() => {
  cleanup()
  stylesheet.remove()
})

describe('tool strip shared tab presentation', () => {
  it.each(['docked', 'overlay'])('keeps a compact rounded tab and glyph in the %s host', host => {
    const onClose = vi.fn()
    const marker = host === 'docked' ? { 'data-tree-tab': 'files' } : { 'data-narrow-overlay-tab': 'files' }
    render(
      <PaneTabStrip variant="tool">
        <PaneTab active onClose={onClose} role="tab" {...marker}>
          <span>
            <svg aria-label="Files icon" />
          </span>
          <PaneTabLabel>Files</PaneTabLabel>
        </PaneTab>
      </PaneTabStrip>
    )

    const tab = screen.getByRole('tab')
    const style = globalThis.getComputedStyle(tab)
    expect(style.height).toBe('32px')
    expect(style.borderRadius).toBe('var(--aino-radius-control)')
    expect(style.minWidth).toBe('100px')
    expect(style.fontSize).toBe('var(--aino-text-label)')
    const iconStyle = globalThis.getComputedStyle(screen.getByLabelText('Files icon'))
    expect(iconStyle.width).toBe('14px')
    expect(iconStyle.height).toBe('14px')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
