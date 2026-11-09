/** Regression coverage for #77429: native picker options must paint a readable surface. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuickEntryStatePush } from '@/store/quick-entry'

import { QuickEntryApp } from './quick-entry-app'

const initialHermesDesktop = window.hermesDesktop

describe('QuickEntryApp', () => {
  let pushState: ((payload: QuickEntryStatePush) => void) | undefined

  beforeEach(() => {
    pushState = undefined
    window.hermesDesktop = {
      quickEntry: {
        dismiss: vi.fn(),
        onShown: vi.fn(() => vi.fn()),
        onState: vi.fn(callback => {
          pushState = callback

          return vi.fn()
        }),
        onLateResult: vi.fn(() => vi.fn()),
        submit: vi.fn()
      }
    } as never
  })

  afterEach(() => {
    cleanup()
    window.hermesDesktop = initialHermesDesktop
    vi.restoreAllMocks()
  })

  it('paints every native target option with matching theme foreground and background tokens', () => {
    render(<QuickEntryApp />)

    act(() => {
      pushState?.({
        connected: true,
        sessions: [{ id: 'session-1', title: 'A recent session' }]
      })
    })

    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options).toHaveLength(3)

    for (const option of options) {
      expect(option.style.color).toBe('var(--ui-text-primary, var(--foreground))')
      expect(option.style.backgroundColor).toBe('var(--ui-bg-elevated, var(--background))')
    }
  })

  it('keeps the submitted draft and target available when delivery fails', async () => {
    vi.mocked(window.hermesDesktop.quickEntry!.submit).mockResolvedValue({
      ok: false,
      message: 'The target is offline.'
    })
    render(<QuickEntryApp />)
    act(() => pushState?.({ connected: true, sessions: [{ id: 'session-1', title: 'A recent session' }] }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'session-1' } })
    fireEvent.change(input, { target: { value: 'Keep this draft' } })

    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }))

    expect(screen.getByRole('alert').textContent).toContain('The target is offline.')
    expect(input.value).toBe('Keep this draft')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('session-1')
    expect(window.hermesDesktop.quickEntry!.submit).toHaveBeenCalledExactlyOnceWith({
      target: 'session-1',
      text: 'Keep this draft'
    })
    expect(window.hermesDesktop.quickEntry!.dismiss).not.toHaveBeenCalled()
  })
})
