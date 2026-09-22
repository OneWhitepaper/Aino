import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $bindings } from '@/store/keybinds'
import { stubResizeObserver } from '@/test/jsdom'

import { $terminalTakeover, setTerminalTakeover } from '../store'

import { TerminalRail } from './rail'
import { $activeTerminalId, $terminals } from './terminals'

describe('TerminalRail', () => {
  beforeEach(() => {
    stubResizeObserver()
    vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
    $terminals.set([{ auto: true, cwd: 'C:\\repo', id: 'term-1', kind: 'user', title: 'PowerShell' }])
    $activeTerminalId.set('term-1')
    setTerminalTakeover(true)
    $bindings.set({ ...$bindings.get(), 'view.showTerminal': ['ctrl+`'] })
  })

  afterEach(() => {
    cleanup()
    $terminals.set([])
    $activeTerminalId.set(null)
    setTerminalTakeover(false)
    vi.unstubAllGlobals()
  })

  it('shows terminal names and keeps hiding separate from closing a tab', () => {
    $terminals.set([
      ...$terminals.get(),
      { auto: false, cwd: '', id: 'term-2', kind: 'agent', procId: 'build-1', title: 'Build logs' }
    ])
    $activeTerminalId.set('term-2')

    render(<TerminalRail />)

    expect(within(screen.getByRole('tab', { name: '1. PowerShell' })).getByText('PowerShell')).toBeTruthy()
    expect(within(screen.getByRole('tab', { name: '2. Build logs' })).getByText('Build logs')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close: 1. PowerShell' }))

    expect($terminals.get().map(term => term.id)).toEqual(['term-2'])
    expect($activeTerminalId.get()).toBe('term-2')
    expect($terminalTakeover.get()).toBe(true)

    const remaining = $terminals.get()
    fireEvent.click(screen.getByRole('button', { name: 'Hide terminal' }))

    expect($terminalTakeover.get()).toBe(false)
    expect($terminals.get()).toBe(remaining)
    expect($activeTerminalId.get()).toBe('term-2')
  })

  it('keeps terminal selection keyboard accessible when new tabs are added', () => {
    $terminals.set([...$terminals.get(), { auto: true, cwd: 'C:\\repo', id: 'term-2', kind: 'user', title: 'zsh' }])

    render(<TerminalRail />)

    const firstTab = screen.getByRole('tab', { name: '1. PowerShell' })
    const secondTab = screen.getByRole('tab', { name: '2. zsh' })
    act(() => firstTab.focus())
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' })

    expect($activeTerminalId.get()).toBe('term-2')
    expect(firstTab.ownerDocument.activeElement).toBe(secondTab)
    expect(secondTab.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(secondTab, { key: 'ArrowLeft' })
    expect($activeTerminalId.get()).toBe('term-1')
    expect(firstTab.ownerDocument.activeElement).toBe(firstTab)

    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))

    const created = $terminals.get().find(term => term.id !== 'term-1' && term.id !== 'term-2')
    expect(created?.kind).toBe('user')
    expect($activeTerminalId.get()).toBe(created?.id)
    expect(screen.getByRole('tab', { name: '3. Terminal' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: '3. Terminal' }), { key: 'Home' })
    expect(firstTab.ownerDocument.activeElement).toBe(firstTab)
    expect($activeTerminalId.get()).toBe('term-1')

    fireEvent.keyDown(firstTab, { key: 'End' })
    expect(firstTab.ownerDocument.activeElement).toBe(screen.getByRole('tab', { name: '3. Terminal' }))
    expect($activeTerminalId.get()).toBe(created?.id)
  })

  it('keeps the terminal hotkey in a portaled bubble below the horizontal tab strip', async () => {
    const view = render(<TerminalRail />)

    fireEvent.pointerMove(screen.getByRole('tab', { name: '1. PowerShell' }), { pointerType: 'mouse' })
    await screen.findByRole('tooltip')

    const content = view.container.ownerDocument.querySelector<HTMLElement>('[data-slot="tooltip-content"]')
    const label = content?.querySelector('[data-slot="tooltip-label"]')

    expect(content).not.toBeNull()
    expect(view.container.contains(content)).toBe(false)
    expect(content?.classList.contains('tooltip-bubble')).toBe(true)
    expect(content?.getAttribute('data-side')).toBe('bottom')
    expect(label?.textContent).toContain('PowerShell')
    expect(content?.querySelector('[data-slot="tooltip-arrow"]')).not.toBeNull()
  })

  it('⌘-click and middle-click close the tab; a plain click selects it', () => {
    $terminals.set([...$terminals.get(), { auto: true, cwd: 'C:\\repo', id: 'term-2', kind: 'user', title: 'zsh' }])

    render(<TerminalRail />)

    fireEvent.click(screen.getByRole('tab', { name: '2. zsh' }), { metaKey: true })
    expect($terminals.get().map(term => term.id)).toEqual(['term-1'])

    fireEvent.click(screen.getByRole('tab', { name: '1. PowerShell' }))
    expect($activeTerminalId.get()).toBe('term-1')
    expect($terminals.get()).toHaveLength(1)

    const tab = screen.getByRole('tab', { name: '1. PowerShell' })
    fireEvent.pointerDown(tab, { button: 1 })
    fireEvent.pointerUp(tab, { button: 1 })
    expect($terminals.get()).toHaveLength(0)
    expect($terminalTakeover.get()).toBe(false)
  })

  it('localizes an untouched automatic terminal title without changing shell names', () => {
    $terminals.set([
      { auto: true, cwd: 'C:\\repo', id: 'term-default', kind: 'user', title: 'Terminal' },
      { auto: true, cwd: 'C:\\repo', id: 'term-shell', kind: 'user', title: 'PowerShell' },
      { auto: false, cwd: 'C:\\repo', id: 'term-custom', kind: 'user', title: 'Terminal' }
    ])

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <TerminalRail />
      </I18nProvider>
    )

    expect(screen.getByRole('tab', { name: '1. 终端' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '2. PowerShell' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '3. Terminal' })).toBeTruthy()
  })
})
