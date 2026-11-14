import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $confirmRequest, runConfirm, settleConfirm } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { runPreviewAgentAction } from './preview-agent'
import { resumePreview, takeOverPreview } from './preview-agent-control'
import { activePreviewInput, type PreviewInputEvent, registerPreviewInput } from './preview-input'
import { type PreviewScriptRunner, registerPreviewScriptRunner } from './preview-script-runner'

const cleanups: Array<() => void> = []
const events: PreviewInputEvent[] = []

function browser(onSend?: (event: PreviewInputEvent, tabId: string) => void) {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!
  const runner: PreviewScriptRunner = async code => new Function('return ' + code)()
  runner.beginApproval = async () => ({
    validate: async () => {},
    input: activePreviewInput()!,
    release: async () => {}
  })

  runner.capture = async () => {
    const bytes = new Uint8Array(24)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    const header = new DataView(bytes.buffer)
    header.setUint32(16, 800)
    header.setUint32(20, 600)

    return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes))
  }

  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  cleanups.push(
    registerPreviewInput(tabId, {
      focus: () => {},
      send: event => {
        events.push(event)

        if (event.type === 'mouseUp') {
          document.querySelector('iframe')?.focus()
        }

        onSend?.(event, tabId)
      }
    })
  )

  return tabId
}

async function approve() {
  await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
  await runConfirm($confirmRequest.get()!)
}

beforeEach(() => {
  events.length = 0
  document.body.innerHTML = '<iframe title="Cross-origin editor"></iframe>'
  const frame = document.querySelector('iframe')!
  // Chromium exposes no child document across this boundary.
  Object.defineProperty(frame, 'contentDocument', { configurable: true, value: null })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => frame })
})

afterEach(() => {
  settleConfirm(false)
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('visual keyboard input into an opaque browser frame', () => {
  it('types through the focused native channel after one approval and returns a fresh screenshot', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'type',
      text: 'Aino',
      coordinate: [100, 100],
      tabId,
      observationId: seen.observation_id
    })

    await approve()
    const result = await operation

    expect(result).toMatchObject({ success: true, acted: 'type', image: { width: 800, height: 600 } })
    expect(events.flatMap(event => (event.type === 'char' ? [event.keyCode] : [])).join('')).toBe('Aino')
    expect(events.some(event => event.type === 'keyDown' && event.keyCode === 'a' && event.modifiers?.length)).toBe(
      true
    )
    expect(events.filter(event => event.type === 'mouseDown')).toHaveLength(1)
    expect($confirmRequest.get()).toBeNull()
  })

  it.each([
    { key: 'ArrowDown', keyCode: 'ArrowDown', modifiers: undefined },
    { key: 'Meta+A', keyCode: 'a', modifiers: ['meta'] },
    { key: 'Ctrl+Shift+ArrowLeft', keyCode: 'ArrowLeft', modifiers: ['control', 'shift'] }
  ])('sends native $key to the approved frame without inserting literal text', async ({ key, keyCode, modifiers }) => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'press',
      key,
      coordinate: [100, 100],
      tabId,
      observationId: seen.observation_id
    })

    await approve()

    expect((await operation).success).toBe(true)
    const modifierFields = modifiers ? { modifiers } : {}
    expect(events).toContainEqual({ type: 'keyDown', keyCode, ...modifierFields })
    expect(events).toContainEqual({ type: 'keyUp', keyCode, ...modifierFields })
    expect(events.filter(event => event.type === 'char')).toHaveLength(0)
  })

  it('rejects an invalid visual key combination before requesting approval or sending input', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const result = await runPreviewAgentAction({
      kind: 'press',
      key: 'Meta++A',
      coordinate: [100, 100],
      tabId,
      observationId: seen.observation_id
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/key combination/i)
    expect(events).toEqual([])
    expect($confirmRequest.get()).toBeNull()
  })

  it('does not type when the approved click failed to focus its visible target', async () => {
    const tabId = browser(event => {
      if (event.type === 'mouseUp') {
        document.querySelector('iframe')?.blur()
      }
    })

    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'type',
      text: 'Must not land',
      coordinate: [100, 100],
      tabId,
      observationId: seen.observation_id
    })

    await approve()

    expect((await operation).success).toBe(false)
    expect(events.filter(event => event.type === 'keyDown' || event.type === 'char')).toHaveLength(0)
  })

  it('does not replace an earlier field when clicking the page background leaves its focus behind', async () => {
    document.body.innerHTML = '<input aria-label="Unrelated draft">'
    document.querySelector('input')!.focus()
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
    const tabId = browser()
    await Promise.resolve()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })
    expect(seen.success).toBe(true)

    const operation = runPreviewAgentAction({
      kind: 'type',
      text: 'Must not land',
      coordinate: [100, 100],
      tabId,
      observationId: seen.observation_id
    })

    await approve()

    expect((await operation).success).toBe(false)
    expect(events.filter(event => event.type === 'keyDown' || event.type === 'char')).toHaveLength(0)
  })

  it('releases a held key and sends no remaining text after user takeover', async () => {
    const tabId = browser((event, owner) => {
      if (event.type === 'keyDown' && event.keyCode === 'A') {
        takeOverPreview(owner)
      }
    })

    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'type',
      text: 'AB',
      coordinate: [100, 100],
      tabId,
      observationId: seen.observation_id
    })

    await approve()

    expect((await operation).success).toBe(false)
    expect(events).toContainEqual({ type: 'keyUp', keyCode: 'A' })
    expect(events.filter(event => event.type === 'char')).toHaveLength(0)
    expect(events.some(event => event.type === 'keyDown' && event.keyCode === 'B')).toBe(false)
    resumePreview(tabId)
  })
})
