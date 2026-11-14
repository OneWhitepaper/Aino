import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $confirmRequest, runConfirm, settleConfirm } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { runPreviewAgentAction } from './preview-agent'
import { resumePreview, takeOverPreview } from './preview-agent-control'
import { registerPreviewInput } from './preview-input'
import {
  invalidatePreviewScriptRunner,
  type PreviewScriptRunner,
  registerPreviewScriptRunner
} from './preview-script-runner'

const cleanups: Array<() => void> = []
const send = vi.fn()

// A native capture's PNG header; parsing this header must preserve bitmap space.
function screenshot(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)

  return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes))
}

function browser() {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  runner.capture = async () => screenshot(800, 600)
  runner.beginApproval = async () => ({ validate: async () => {}, input: { focus: () => {}, send }, release: async () => {} })
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  cleanups.push(registerPreviewInput(tabId, { focus: () => {}, send }))

  return tabId
}

it('refuses sensitive input when native approval observation is unavailable', async () => {
  const tabId = browser()
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  const result = await runPreviewAgentAction({ kind: 'click', selector: '#buy', tabId })
  expect(result).toMatchObject({ success: false, error: expect.stringContaining('observation is unavailable') })
  expect($confirmRequest.get()).toBeNull()
  expect(send).not.toHaveBeenCalled()
})

it('releases and rejects native approval invalidated behind an opaque target before clicking', async () => {
  const tabId = browser()
  const release = vi.fn(async () => {})
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  runner.beginApproval = async () => ({
    validate: async () => { throw new Error('Embedded target changed') },
    input: { focus: () => {}, send }, release
  })
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  const result = runPreviewAgentAction({ kind: 'click', selector: '#buy', tabId })
  await accept()
  expect(await result).toMatchObject({ success: false, error: 'Embedded target changed' })
  expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
  expect(release).toHaveBeenCalledOnce()
})

async function accept() {
  await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
  await runConfirm($confirmRequest.get()!)
}

it('refuses a target changed by hover before offering approval or clicking', async () => {
  const tabId = browser()
  send.mockImplementation(event => {
    if (event.type === 'mouseMove') {document.querySelector('#buy')!.textContent = 'Pay another recipient'}
  })
  const result = await runPreviewAgentAction({ kind: 'click', selector: '#buy', tabId })
  expect(result).toMatchObject({ success: false, error: expect.stringContaining('positioning the pointer') })
  expect($confirmRequest.get()).toBeNull()
  expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
})

beforeEach(() => {
  send.mockReset()
  document.body.innerHTML = '<button id="buy">Pay now</button>'
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => document.getElementById('buy')
  })
})

afterEach(() => {
  settleConfirm(false)
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('preview agent observation and control', () => {
  it('returns an image with the exact browser target, URL and bitmap size', async () => {
    const tabId = browser()
    const result = await runPreviewAgentAction({ kind: 'screenshot', tabId })
    expect(result).toMatchObject({
      image: { width: 800, height: 600 },
      success: true,
      tab_id: tabId,
      url: location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    })
    expect(result.observation_id).toBeTruthy()
  })

  it('refuses coordinates without a matching observation and sends no input', async () => {
    const tabId = browser()
    const result = await runPreviewAgentAction({ kind: 'click', coordinate: [400, 300], tabId, observationId: 'old' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('observation')
    expect(send).not.toHaveBeenCalled()
  })

  it('requires confirmation before a visual click and maps bitmap pixels into the viewport', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'click',
      coordinate: [400, 300],
      tabId,
      observationId: seen.observation_id
    })

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
    await accept()
    expect((await operation).success).toBe(true)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', x: window.innerWidth / 2, y: window.innerHeight / 2 })
    )
  })

  it('invalidates an approval when navigation replaces its document', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'click',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    invalidatePreviewScriptRunner(tabId)
    await accept()
    expect((await operation).success).toBe(false)
    expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
  })

  it('retires old coordinates after switching away and back to the same tab', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })
    browser()
    $rightRailActiveTabId.set(tabId)

    const result = await runPreviewAgentAction({
      kind: 'click',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    expect(result.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect($confirmRequest.get()).toBeNull()
  })

  it('does not revive pending approval after switching away and back', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'click',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    browser()
    $rightRailActiveTabId.set(tabId)
    await accept()
    expect((await operation).success).toBe(false)
    expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
  })

  it('keeps human control after takeover and cancels the pending approval', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'click',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    takeOverPreview(tabId)
    expect((await operation).success).toBe(false)
    expect($confirmRequest.get()).toBeNull()
    expect((await runPreviewAgentAction({ kind: 'click', ref: 'buy', tabId })).success).toBe(false)
    expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
    resumePreview(tabId)
  })

  it('does not reuse screenshot coordinates after the page scrolls', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })
    vi.stubGlobal('scrollY', 200)

    try {
      const result = await runPreviewAgentAction({
        kind: 'click',
        coordinate: [30, 30],
        tabId,
        observationId: seen.observation_id
      })

      expect(result.success).toBe(false)
      expect(send).not.toHaveBeenCalled()
      expect($confirmRequest.get()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requires a new observation after the visible page changes', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })
    document.getElementById('buy')!.textContent = 'A different action'
    await Promise.resolve()

    const result = await runPreviewAgentAction({
      kind: 'click',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('stale')
    expect(send).not.toHaveBeenCalled()
    expect($confirmRequest.get()).toBeNull()
  })

  it('returns a fresh image after an approved click for result verification', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const operation = runPreviewAgentAction({
      kind: 'click',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    await accept()
    const after = await operation
    expect(after).toMatchObject({ success: true, acted: 'click', image: { width: 800, height: 600 } })
    expect(after.observation_id).not.toBe(seen.observation_id)
  })

  it('keeps drag input on the original guest and releases the held button on takeover', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })
    send
      .mockImplementationOnce(() => {})
      .mockImplementation(event => {
        if (event.type === 'mouseDown') {
          takeOverPreview(tabId)
        }
      })

    const operation = runPreviewAgentAction({
      kind: 'drag',
      coordinate: [30, 30],
      toCoordinate: [200, 200],
      tabId,
      observationId: seen.observation_id
    })

    await accept()
    const result = await operation
    expect(result.success).toBe(false)
    expect(send.mock.calls.filter(([event]) => event.type === 'mouseDown')).toHaveLength(1)
    expect(send.mock.calls.filter(([event]) => event.type === 'mouseUp')).toHaveLength(1)
    expect(send.mock.calls.find(([event]) => event.type === 'mouseUp')?.[0]).toMatchObject({
      x: (30 * window.innerWidth) / 800,
      y: (30 * window.innerHeight) / 600
    })
    resumePreview(tabId)
    send.mockReset()
  })

  it('never bypasses human takeover or explicit tab targeting while the document loads', async () => {
    const tabId = browser()
    takeOverPreview(tabId)
    invalidatePreviewScriptRunner(tabId)
    const result = await runPreviewAgentAction({ kind: 'click', selector: '#buy', tabId: 'another-tab' })
    expect(result.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
    resumePreview(tabId)
  })

  it('does not confuse target scrolling before confirmation with a changed approval', async () => {
    const tabId = browser()

    const scroll = vi.fn(() => {
      vi.stubGlobal('scrollY', 120)
    })

    document.getElementById('buy')!.scrollIntoView = scroll

    try {
      const operation = runPreviewAgentAction({ kind: 'click', selector: '#buy', tabId })
      await accept()
      const result = await operation
      expect(result.error ?? '').not.toContain('while confirmation')
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a changed screenshot instead of attaching stale viewport metadata', async () => {
    const tabId = browser()
    let captures = 0
    const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
    runner.beginApproval = async () => ({ validate: async () => {}, input: { focus: () => {}, send }, release: async () => {} })

    runner.capture = async () => {
      if (++captures === 2) {
        vi.stubGlobal('scrollY', 90)
      }

      return screenshot(800, 600)
    }

    cleanups.push(registerPreviewScriptRunner(tabId, runner))

    try {
      const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

      const operation = runPreviewAgentAction({
        kind: 'click',
        coordinate: [30, 30],
        tabId,
        observationId: seen.observation_id
      })

      await accept()
      const result = await operation
      expect(result.success).toBe(true)
      expect(result.image).toBeUndefined()
      expect(result.note).toContain('do not repeat')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects malformed visual actions before opening confirmation or dispatching input', async () => {
    const tabId = browser()
    const seen = await runPreviewAgentAction({ kind: 'screenshot', tabId })

    const result = await runPreviewAgentAction({
      kind: 'scroll',
      coordinate: [30, 30],
      tabId,
      observationId: seen.observation_id
    })

    expect(result.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect($confirmRequest.get()).toBeNull()
  })
})
