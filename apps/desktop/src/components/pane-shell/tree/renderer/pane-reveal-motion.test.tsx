import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { PaneLayer } from './pane-layer'
import { usePaneRevealMotion } from './use-pane-reveal-motion'

const animations: { cancel: ReturnType<typeof vi.fn> }[] = []

afterEach(() => {
  cleanup()
  animations.length = 0
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})

function setup(reducedMotion = false) {
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: () => {
      const animation = { cancel: vi.fn() }
      animations.push(animation)

      return animation
    }
  })
}

it('reveals existing tool content and cancels it immediately on a tab switch', () => {
  setup()

  const view = render(
    <PaneLayer active={false} animated>
      <textarea defaultValue="Keep draft" />
    </PaneLayer>
  )

  const editor = view.container.querySelector('textarea')!
  expect(animations).toHaveLength(0)
  view.rerender(
    <PaneLayer active animated>
      <textarea defaultValue="Keep draft" />
    </PaneLayer>
  )
  expect(animations).toHaveLength(1)
  editor.focus()
  view.rerender(
    <PaneLayer active={false} animated>
      <textarea defaultValue="Keep draft" />
    </PaneLayer>
  )
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  expect(editor.closest('[inert]')).toBeTruthy()
  expect(editor.ownerDocument.activeElement).not.toBe(editor)
  view.rerender(
    <PaneLayer active animated>
      <textarea defaultValue="Keep draft" />
    </PaneLayer>
  )
  expect(view.container.querySelector('textarea')).toBe(editor)
  expect(editor.value).toBe('Keep draft')
  expect(animations).toHaveLength(2)
})

it('keeps ordinary panes and reduced-motion tool switches instant', () => {
  setup(true)

  const view = render(
    <PaneLayer active animated>
      Tool content
    </PaneLayer>
  )

  expect(animations).toHaveLength(0)
  expect(view.container.textContent).toBe('Tool content')
  view.rerender(<PaneLayer active>Conversation</PaneLayer>)
  expect(animations).toHaveLength(0)
})

function RetainedOverlay({ activeTool }: { activeTool: string }) {
  const ref = useRef<HTMLDivElement>(null)
  usePaneRevealMotion(ref, true, true, activeTool)

  return (
    <div ref={ref}>
      <textarea defaultValue="Keep the tool draft" />
    </div>
  )
}

it('reveals a newly selected narrow tool in the same overlay without remounting or changing focus', () => {
  setup()
  const view = render(<RetainedOverlay activeTool="files" />)
  const editor = view.container.querySelector('textarea')!
  const host = editor.parentElement!
  editor.focus()
  view.rerender(<RetainedOverlay activeTool="files" />)
  expect(animations).toHaveLength(1)

  view.rerender(<RetainedOverlay activeTool="review" />)
  expect(animations).toHaveLength(2)
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  expect(view.container.querySelector('textarea')).toBe(editor)
  expect(editor.parentElement).toBe(host)
  expect(editor.value).toBe('Keep the tool draft')
  expect(editor.ownerDocument.activeElement).toBe(editor)
})
