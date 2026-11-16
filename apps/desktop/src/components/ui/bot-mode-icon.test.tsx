import { act, cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { installWindowStateBridge, setDocumentHidden, type WindowStateBridge } from '@/test/window-state'

import { BotModeIcon } from './bot-mode-icon'

const avatars = vi.hoisted(() => {
  const instances: {
    initial: Record<string, unknown>
    update: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }[] = []

  return {
    instances,
    mount: vi.fn((_host: HTMLElement, initial: Record<string, unknown>) => {
      const avatar = { initial, update: vi.fn(), destroy: vi.fn() }
      instances.push(avatar)

      return avatar
    })
  }
})

vi.mock('open-bot-avatar/dom', () => ({ mountAvatar: avatars.mount }))

const originalBridge = Object.getOwnPropertyDescriptor(window, 'hermesDesktop')
const originalHidden = Object.getOwnPropertyDescriptor(window.document, 'hidden')
const originalVisibility = Object.getOwnPropertyDescriptor(window.document, 'visibilityState')

function animationState() {
  const avatar = avatars.instances.at(-1)!

  return Object.assign({}, avatar.initial, ...avatar.update.mock.calls.map(([options]) => options))
}

function restoreProperty(target: object, key: string, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    Reflect.deleteProperty(target, key)
  }
}

describe('BotModeIcon animation lifecycle', () => {
  let windowState: WindowStateBridge

  beforeEach(() => {
    avatars.instances.length = 0
    avatars.mount.mockClear()
    setDocumentHidden(false)
    vi.spyOn(window.document, 'hasFocus').mockReturnValue(true)
    windowState = installWindowStateBridge()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    restoreProperty(window, 'hermesDesktop', originalBridge)
    restoreProperty(window.document, 'hidden', originalHidden)
    restoreProperty(window.document, 'visibilityState', originalVisibility)
  })

  it('keeps a visible window animated across blur, and pauses while hidden or minimized', () => {
    render(<BotModeIcon />)
    expect(animationState()).toMatchObject({ still: false, followPointer: true, reducedMotion: 'system' })

    act(() => window.dispatchEvent(new Event('blur')))
    expect(animationState()).toMatchObject({ still: false, followPointer: true })

    act(() => {
      setDocumentHidden(true)
      window.document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(animationState()).toMatchObject({ still: true, followPointer: false })

    act(() => windowState.emit({ isMinimized: true, isVisible: false }))
    act(() => {
      setDocumentHidden(false)
      window.document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(animationState()).toMatchObject({ still: true, followPointer: false })

    act(() => windowState.emit({ isMinimized: false, isVisible: true }))
    expect(animationState()).toMatchObject({ still: false, followPointer: true })
  })

  it('parks a kept-alive pane until it is visible, including after the window is restored', () => {
    const view = render(
      <PaneVisibleContext value={false}>
        <BotModeIcon />
      </PaneVisibleContext>
    )

    expect(animationState()).toMatchObject({ still: true, followPointer: false })

    act(() => windowState.emit({ isMinimized: true, isVisible: false }))
    act(() => windowState.emit({ isMinimized: false, isVisible: true }))
    expect(animationState()).toMatchObject({ still: true, followPointer: false })

    view.rerender(
      <PaneVisibleContext value={true}>
        <BotModeIcon />
      </PaneVisibleContext>
    )
    expect(animationState()).toMatchObject({ still: false, followPointer: true })

    view.rerender(
      <PaneVisibleContext value={false}>
        <BotModeIcon />
      </PaneVisibleContext>
    )
    expect(animationState()).toMatchObject({ still: true, followPointer: false })
  })

  it('destroys every mounted avatar and releases native and document listeners through Strict Mode remounts', () => {
    const view = render(
      <StrictMode>
        <BotModeIcon />
      </StrictMode>
    )

    expect(avatars.instances.length).toBeGreaterThan(1)

    view.unmount()

    for (const avatar of avatars.instances) {
      expect(avatar.destroy).toHaveBeenCalledTimes(1)
    }

    expect(windowState.off).toHaveBeenCalledTimes(avatars.instances.length)
    const updateCounts = avatars.instances.map(avatar => avatar.update.mock.calls.length)

    act(() => {
      windowState.emit({ isMinimized: true, isVisible: false })
      setDocumentHidden(true)
      window.document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(avatars.instances.map(avatar => avatar.update.mock.calls.length)).toEqual(updateCounts)
  })
})
