import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SidebarModeHeader, type SidebarModeItem } from './sidebar-mode-header'

vi.mock('@/components/brand-mark', () => ({ BrandMark: () => <span aria-hidden="true" /> }))

const items: SidebarModeItem[] = [
  { id: 'sessions', title: 'Aino', description: 'Projects, files and conversations' },
  { id: 'bots:pane', title: 'Agent Hub', description: 'Bots, group chats and collaboration' }
]

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
})

afterEach(cleanup)

describe('SidebarModeHeader', () => {
  it('requests an existing pane selection and waits for the owner to update the current title', async () => {
    const onSelect = vi.fn()

    const { rerender } = render(
      <SidebarModeHeader activeId="sessions" items={items} menuLabel="Switch mode" onSelect={onSelect} />
    )

    const trigger = screen.getByRole('button', { name: 'Switch mode: Aino' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const current = await screen.findByRole('menuitemradio', { name: /^Aino/ })
    expect(current.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Agent Hub/ }))

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('bots:pane')
    expect(screen.getByRole('button', { name: 'Switch mode: Aino' })).toBeTruthy()

    rerender(<SidebarModeHeader activeId="bots:pane" items={items} menuLabel="Switch mode" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Switch mode: Agent Hub' })).toBeTruthy()

    rerender(
      <SidebarModeHeader activeId="sessions" items={items.slice(0, 1)} menuLabel="Switch mode" onSelect={onSelect} />
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByText('Aino')).toBeTruthy()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('dismisses with Escape without changing the active pane and returns focus to the brand trigger', async () => {
    const onSelect = vi.fn()
    render(<SidebarModeHeader activeId="sessions" items={items} menuLabel="Switch mode" onSelect={onSelect} />)

    const trigger = screen.getByRole('button', { name: 'Switch mode: Aino' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = await screen.findByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(trigger.ownerDocument.activeElement).toBe(trigger))
  })
})
