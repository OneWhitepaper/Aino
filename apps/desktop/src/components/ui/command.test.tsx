import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { Command, CommandInput, CommandItem, CommandList } from './command'

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderPicker(disablePointerSelection?: boolean) {
  const select = vi.fn()
  render(
    <Command defaultValue="alpha" disablePointerSelection={disablePointerSelection} label="Search models">
      <CommandInput />
      <CommandList>
        <CommandItem onSelect={select} value="alpha">
          Alpha
        </CommandItem>
        <CommandItem onSelect={select} value="beta">
          Beta
        </CommandItem>
      </CommandList>
    </Command>
  )
  const alpha = screen.getByRole('option', { name: 'Alpha' })
  const beta = screen.getByRole('option', { name: 'Beta' })
  await waitFor(() => expect(alpha.getAttribute('aria-selected')).toBe('true'))

  return { alpha, beta, select, input: screen.getByRole('combobox', { name: 'Search models' }) }
}

describe('Command selection intent', () => {
  it('keeps the keyboard highlight when a list opens under a parked pointer', async () => {
    const { alpha, beta } = await renderPicker()

    fireEvent.pointerMove(beta)

    expect(alpha.getAttribute('aria-selected')).toBe('true')
    expect(beta.getAttribute('aria-selected')).toBe('false')
  })

  it('accepts a direct option click without requiring pointer movement first', async () => {
    const { beta, select } = await renderPicker()

    fireEvent.click(beta)

    expect(select).toHaveBeenCalledExactlyOnceWith('beta')
    expect(beta.getAttribute('aria-selected')).toBe('true')
  })

  it('supports keyboard selection while pointer hover is quiet', async () => {
    const { beta, input, select } = await renderPicker()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(beta.getAttribute('aria-selected')).toBe('true')
    expect(select).toHaveBeenCalledExactlyOnceWith('beta')
  })

  it('restores hover selection after the user moves the pointer', async () => {
    const { beta } = await renderPicker()

    fireEvent.mouseMove(window)
    fireEvent.pointerMove(beta)

    expect(beta.getAttribute('aria-selected')).toBe('true')
  })

  it.each([false, true])('respects an explicit hover-selection override of %s', async disabled => {
    const { alpha, beta } = await renderPicker(disabled)

    fireEvent.mouseMove(window)
    fireEvent.pointerMove(beta)

    expect(alpha.getAttribute('aria-selected')).toBe(String(disabled))
    expect(beta.getAttribute('aria-selected')).toBe(String(!disabled))
  })
})
