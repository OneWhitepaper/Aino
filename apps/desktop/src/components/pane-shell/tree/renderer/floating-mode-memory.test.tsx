import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { registry as registryValue } from '@/contrib/registry'
import type { setInterfaceMode as setInterfaceModeValue } from '@/store/interface-mode'

import type { FloatingPanes as FloatingPanesValue } from './floating-panes'

afterEach(cleanup)

let registry: typeof registryValue
let setInterfaceMode: typeof setInterfaceModeValue
let FloatingPanes: typeof FloatingPanesValue

beforeEach(async () => {
  window.localStorage.clear()
  vi.resetModules()
  window.localStorage.setItem('hermes.desktop.floatingPanes.v1', JSON.stringify({ card: { x: 37, y: 71 } }))
  registry = (await import('@/contrib/registry')).registry
  setInterfaceMode = (await import('@/store/interface-mode')).setInterfaceMode
  FloatingPanes = (await import('./floating-panes')).FloatingPanes
})

it.each([false, true])('restores floating geometry and collapse with keep-alive=%s', keepAlive => {
  const dispose = registry.register({
    area: 'panes',
    id: 'card',
    title: 'Card',
    data: { placement: 'floating', width: 240, height: 180, lifecycleKeepAlive: keepAlive },
    render: () => <input aria-label="Floating draft" defaultValue="original" />
  })

  try {
    const view = render(<FloatingPanes />)
    const card = () => view.container.querySelector<HTMLElement>('[data-floating-pane="card"]')!
    expect(card().style.left).toBe('37px')
    expect(card().style.top).toBe('71px')
    const input = view.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'unsaved' } })
    act(() => setInterfaceMode('simple'))
    expect(card().style.left).not.toBe('37px')
    const simplePosition = card().style.left
    fireEvent.click(view.getByRole('button'))
    expect(input.isConnected).toBe(keepAlive)
    act(() => setInterfaceMode('advanced'))
    expect(card().style.left).toBe('37px')
    expect(card().style.top).toBe('71px')
    expect(view.getByRole('textbox')).toBeDefined()

    if (keepAlive) {
      expect(view.getByRole('textbox')).toBe(input)
      expect(input.value).toBe('unsaved')
    }

    act(() => setInterfaceMode('simple'))
    expect(card().style.left).toBe(simplePosition)
    expect(view.queryByRole('textbox')).toBeNull()
  } finally {
    act(dispose)
  }
})
