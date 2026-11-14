import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { actInPage, type PreviewActHolder } from '@/lib/preview-act/act-in-page'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, openPreview } from '@/store/preview'

import { actOnActivePreview } from './preview-act'
import { type PreviewInputEvent, registerPreviewInput } from './preview-input'
import { registerPreviewScriptRunner } from './preview-script-runner'

const rect = (left = 20, top = 30) =>
  ({ bottom: top + 40, height: 40, left, right: left + 100, top, width: 100, x: left, y: top }) as DOMRect

let cleanups: Array<() => void> = []

beforeEach(() => {
  document.body.replaceChildren()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect())
  Element.prototype.scrollIntoView = vi.fn()
  closeRightRail()
  openPreview({ kind: 'url', label: 'Browser', source: 'https://example.com', url: 'https://example.com' })
})

afterEach(() => {
  for (const cleanup of cleanups) {
    cleanup()
  }

  cleanups = []
  vi.restoreAllMocks()
  closeRightRail()
  document.querySelector('hermes-watch')?.remove()
  const state = window as unknown as Record<string, unknown>
  delete state.__hermesActHolder
  delete state.__hermesWatch
})

function wire(target: HTMLElement, send: (event: PreviewInputEvent) => void) {
  const tabId = $rightRailActiveTabId.get()!
  cleanups.push(registerPreviewScriptRunner(tabId, code => new Function('return ' + code)()))
  cleanups.push(registerPreviewInput(tabId, { focus: () => undefined, send }))
  const holder = ((window as unknown as { __hermesActHolder: PreviewActHolder }).__hermesActHolder = {})

  const entry = actInPage(document, holder, { kind: 'elements' }).elements!.find(
    element => element.label === target.getAttribute('aria-label') || element.label === target.textContent
  )!

  expect(entry).toBeDefined()

  return entry.ref
}

describe('native preview input across DOM surfaces', () => {
  it('preserves inventory limits and opaque-frame guidance after trusted input', async () => {
    document.body.innerHTML =
      '<button>Save draft</button>' +
      Array.from({ length: 125 }, (_, index) => `<button>Action ${index}</button>`).join('') +
      '<iframe title="Cross-origin content"></iframe>'
    Object.defineProperty(document.querySelector('iframe')!, 'contentDocument', { value: null })
    const button = document.querySelector('button')!

    const ref = wire(button, event => {
      if (event.type === 'mouseDown') {
        button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      }
    })

    const result = await actOnActivePreview({ kind: 'click', ref })

    expect(result.success).toBe(true)
    expect(result.note).toContain('capped at 120')
    expect(result.note).toContain('embedded frames are not readable')
  })

  it('stops sending text when the owning page changes during typing', async () => {
    document.body.innerHTML = '<input aria-label="Name">'
    const field = document.querySelector('input')!
    const sent: PreviewInputEvent[] = []
    let changed = false

    const ref = wire(field, event => {
      sent.push(event)

      if (event.type === 'mouseDown') {
        field.focus()
        field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      }

      if (event.type === 'char' && event.keyCode === 'a') {
        changed = true
      }
    })

    const result = await actOnActivePreview({ kind: 'type', ref, text: 'abc' }, undefined, undefined, () => {
      if (changed) {
        throw new Error('The page changed during this operation.')
      }
    })

    expect(result.success).toBe(false)
    expect(sent.flatMap(event => (event.type === 'char' && 'keyCode' in event ? [event.keyCode] : []))).toEqual(['a'])
  })

  it('records a click delivered to a same-origin child document', async () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    frame.contentDocument!.body.innerHTML = '<button>Save framed form</button>'
    const button = frame.contentDocument!.querySelector('button')!
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(rect(40, 50))
    Object.defineProperty(button, 'scrollIntoView', { value: vi.fn() })
    const pressed: PreviewInputEvent[] = []

    const ref = wire(button, event => {
      pressed.push(event)

      if (event.type === 'mouseDown') {
        const mouse = childEvent(frame.contentDocument!)
        button.dispatchEvent(mouse)
      }
    })

    const result = await actOnActivePreview({ kind: 'click', ref })
    expect(result.success).toBe(true)
    expect(pressed.find(event => event.type === 'mouseDown')).toMatchObject({ x: 110, y: 100 })
  })

  it('uses the deeply focused shadow field for mask fallback and direct value changes', async () => {
    const host = document.createElement('section')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<input aria-label="Masked amount" value="9.99">'
    const field = shadow.querySelector('input')!
    const input = vi.fn()
    field.addEventListener('input', input)

    const ref = wire(field, event => {
      if (event.type === 'mouseDown') {
        field.focus()
        field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
      }
      // This input keeps its mask during select-all/backspace, forcing the
      // production fallback to target the real focused field inside the root.
    })

    const result = await actOnActivePreview({ kind: 'type', ref, text: '19.99' })
    expect(result.success).toBe(true)
    expect(field.value).toBe('19.99')
    expect(input).toHaveBeenCalledOnce()
  })
})

function childEvent(child: Document): Event {
  const event = child.createEvent('MouseEvent')
  event.initEvent('pointerdown', true, true)

  return event
}
