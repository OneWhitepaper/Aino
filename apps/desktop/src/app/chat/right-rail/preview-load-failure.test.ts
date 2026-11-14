import { afterEach, expect, it, vi } from 'vitest'

import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { runPreviewAgentAction } from './preview-agent'
import { readActivePreview, registerPreviewPageReader } from './preview-reader'
import { registerPreviewScriptRunner, watchPreviewDocumentLifecycle } from './preview-script-runner'

const cleanups: Array<() => void> = []

function browser() {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!
  const native = new EventTarget()
  cleanups.push(registerPreviewScriptRunner(tabId, async () => undefined, { initiallyReady: false }))
  cleanups.push(watchPreviewDocumentLifecycle(native, tabId))

  return { native, tabId }
}

function failure(native: EventTarget, isMainFrame = true, errorCode = -118) {
  native.dispatchEvent(
    Object.assign(new Event('did-fail-load'), {
      errorCode,
      errorDescription: 'ERR_CONNECTION_TIMED_OUT',
      isMainFrame,
      validatedURL: 'https://unreachable.example/'
    })
  )
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
})

it('reports a failed main-frame load to read and drive, then clears it when navigation recovers', async () => {
  const { native, tabId } = browser()
  const reader = vi.fn(async () => ({ text: 'Recovered content', title: 'Recovered', url: 'https://working.example/' }))
  cleanups.push(registerPreviewPageReader(tabId, reader))
  failure(native)
  // Chromium may still announce an error document; that is not a successful navigation.
  native.dispatchEvent(new Event('dom-ready'))

  expect(await readActivePreview()).toMatchObject({
    load_error: { code: -118, description: 'ERR_CONNECTION_TIMED_OUT', url: 'https://unreachable.example/' },
    note: expect.stringContaining('failed to load'),
    text: '',
    url: 'https://unreachable.example/'
  })
  expect(reader).not.toHaveBeenCalled()
  expect(await runPreviewAgentAction({ kind: 'elements', tabId })).toMatchObject({
    error: expect.stringContaining('ERR_CONNECTION_TIMED_OUT'),
    success: false
  })

  native.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: false }))
  native.dispatchEvent(new Event('dom-ready'))
  const recovered = await readActivePreview()

  expect(recovered?.text).toBe('Recovered content')
  expect(recovered).not.toHaveProperty('load_error')
})

it('keeps load failures inside the owning tab and ignores failed subframes and aborted navigations', async () => {
  const first = browser()
  failure(first.native)
  expect((await readActivePreview())?.note).toContain('ERR_CONNECTION_TIMED_OUT')

  const second = browser()
  cleanups.push(
    registerPreviewPageReader(second.tabId, async () => ({
      text: 'Other page',
      title: 'Other',
      url: 'https://other.example/'
    }))
  )
  second.native.dispatchEvent(new Event('dom-ready'))
  failure(second.native, false)
  failure(second.native, true, -3)

  const result = await readActivePreview()
  expect(result?.text).toBe('Other page')
  expect(result).not.toHaveProperty('load_error')
})
