import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { actInPage, type PreviewActHolder } from '@/lib/preview-act/act-in-page'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { actOnActivePreview } from './preview-act'
import type { PreviewObservation } from './preview-agent-observation'
import { performVisualPreviewAction } from './preview-agent-visual'
import { type PreviewInputEvent, registerPreviewInput } from './preview-input'
import { registerPreviewScriptRunner } from './preview-script-runner'

const cleanups: Array<() => void> = []

beforeEach(() => {
  document.body.innerHTML = '<button id="edit">Edit draft</button>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 80,
    height: 40,
    right: 80,
    bottom: 40
  } as DOMRect)
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => document.querySelector('button')
  })
  newBrowserTab()
})

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
  vi.restoreAllMocks()
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
  delete (window as unknown as { __hermesActHolder?: unknown }).__hermesActHolder
  document.querySelector('hermes-watch')?.remove()
})

it('sends native first and second click counts on the semantic target', async () => {
  const tabId = $rightRailActiveTabId.get()!
  const events: PreviewInputEvent[] = []
  cleanups.push(registerPreviewScriptRunner(tabId, code => new Function('return ' + code)()))
  cleanups.push(
    registerPreviewInput(tabId, {
      focus: () => {},
      send: event => {
        events.push(event)

        if (event.type === 'mouseDown') {
          document.querySelector('button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        }
      }
    })
  )
  const holder = ((window as unknown as { __hermesActHolder: PreviewActHolder }).__hermesActHolder = {})
  const ref = actInPage(document, holder, { kind: 'elements' }).elements![0].ref

  const result = await actOnActivePreview({ kind: 'double_click', ref })
  expect(result.success).toBe(true)
  expect(
    events
      .filter(event => event.type === 'mouseDown' || event.type === 'mouseUp')
      .map(event => [event.type, 'clickCount' in event && event.clickCount])
  ).toEqual([
    ['mouseDown', 1],
    ['mouseUp', 1],
    ['mouseDown', 2],
    ['mouseUp', 2]
  ])
})

it('dispatches a double-click to the same target on the synthetic fallback', () => {
  const button = document.querySelector('button')!
  const clicks = vi.fn()
  const double = vi.fn()
  button.addEventListener('click', clicks)
  button.addEventListener('dblclick', double)
  const result = actInPage(document, {}, { kind: 'double_click', selector: '#edit' })
  expect(result.success).toBe(true)
  expect(clicks).toHaveBeenCalledTimes(2)
  expect(double).toHaveBeenCalledOnce()
})

it('maps a visual double-click to exactly two trusted pointer click sequences', async () => {
  const events: PreviewInputEvent[] = []
  const seen = { image: { width: 200, height: 100 }, state: { width: 800, height: 400 } } as PreviewObservation
  await performVisualPreviewAction(
    { kind: 'double_click', coordinate: [10, 5] },
    seen,
    { focus: () => {}, send: event => events.push(event) },
    () => {},
    new AbortController().signal,
    async () => true
  )
  expect(events.filter(event => event.type === 'mouseDown' || event.type === 'mouseUp')).toEqual([
    { type: 'mouseDown', button: 'left', clickCount: 1, x: 40, y: 20 },
    { type: 'mouseUp', button: 'left', clickCount: 1, x: 40, y: 20 },
    { type: 'mouseDown', button: 'left', clickCount: 2, x: 40, y: 20 },
    { type: 'mouseUp', button: 'left', clickCount: 2, x: 40, y: 20 }
  ])
})
