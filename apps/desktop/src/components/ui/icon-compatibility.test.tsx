import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Keyboard, Search, Sun } from '@/lib/icons'

import { Codicon } from './codicon'

afterEach(cleanup)

describe('shared icon compatibility', () => {
  it.each([Search, Keyboard, Sun])('keeps SVG props, title, ref and events for %s', Icon => {
    const ref = createRef<SVGSVGElement>()
    const onClick = vi.fn()

    const { rerender } = render(
      <Icon
        className="toolbar-search"
        color="red"
        onClick={onClick}
        ref={ref}
        role="img"
        size={18}
        stroke={2}
        title="Search files"
      />
    )

    const icon = screen.getByRole('img', { name: 'Search files' })
    expect(ref.current).toBe(icon)
    expect(icon.getAttribute('width')).toBe('18')
    expect(icon.getAttribute('height')).toBe('18')
    expect(icon.getAttribute('color')).toBe('red')
    expect(icon.getAttribute('stroke-width')).toBe('2')
    expect(icon.classList.contains('toolbar-search')).toBe(true)
    expect(icon.hasAttribute('aria-hidden')).toBe(false)
    fireEvent.click(icon)
    expect(onClick).toHaveBeenCalledOnce()

    rerender(<Icon aria-label="Search files" role="img" />)
    expect(screen.getByRole('img', { name: 'Search files' }).hasAttribute('aria-hidden')).toBe(false)

    rerender(<Icon aria-hidden aria-label="Search files" role="img" />)
    expect(screen.queryByRole('img', { name: 'Search files' })).toBeNull()
  })

  it('preserves compact sizing, animation and attributes for shared and extension names', () => {
    const { rerender } = render(
      <Codicon data-testid="glyph" name="refresh" size={18} spinning style={{ color: 'red' }} />
    )

    const glyph = screen.getByTestId('glyph')
    expect(glyph.style.fontSize).toBe('18px')
    expect(glyph.style.color).toBe('red')
    expect(glyph.classList.contains('codicon-modifier-spin')).toBe(true)
    expect(glyph.querySelector('svg')?.getAttribute('width')).toBe('1em')

    rerender(<Codicon data-testid="glyph" name="extension-custom-tool" size="1.25em" />)
    expect(glyph.style.fontSize).toBe('1.25em')
    expect(glyph.classList.contains('codicon-extension-custom-tool')).toBe(true)
    expect(glyph.classList.contains('codicon-modifier-spin')).toBe(false)
    expect(glyph.querySelector('svg')).toBeNull()

    rerender(<Codicon data-testid="glyph" name="constructor" />)
    expect(screen.getByTestId('glyph').classList.contains('codicon-constructor')).toBe(true)
    expect(screen.getByTestId('glyph').querySelector('svg')).toBeNull()
  })
})
