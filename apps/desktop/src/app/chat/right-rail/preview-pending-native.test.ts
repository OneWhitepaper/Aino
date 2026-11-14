import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { PreviewActResult } from '@/lib/preview-act/types'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { runPreviewAgentAction } from './preview-agent'
import { registerPreviewInput } from './preview-input'
import { $previewWebsiteDialogs, $previewWebsiteFileChoosers } from './preview-native-actions'
import { observeAfterPreviewInput } from './preview-pending-native'
import { type PreviewScriptRunner, registerPreviewScriptRunner } from './preview-script-runner'

const cleanups: Array<() => void> = []
let controller: AbortController

const pendingDialog = {
  id: 'dialog-once',
  type: 'alert',
  message: 'Opened once',
  url: 'https://fixture.test',
  sensitive: false,
  state: 'pending' as const
}

beforeEach(() => {
  controller = new AbortController()
  document.body.innerHTML = '<button id="notice" type="button">Open notice</button>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 80,
    bottom: 40,
    width: 80,
    height: 40
  } as DOMRect)
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => document.querySelector('button')
  })
  newBrowserTab()
})

afterEach(() => {
  controller.abort()
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
  $previewWebsiteDialogs.set({})
  $previewWebsiteFileChoosers.set({})
  vi.restoreAllMocks()
  delete (window as unknown as { __hermesActHolder?: unknown }).__hermesActHolder
  document.querySelector('hermes-watch')?.remove()
})

it.each(['dialog', 'chooser'])(
  'returns one successful action receipt for an immediately opened native %s without waiting for guest JS',
  async kind => {
    const tabId = $rightRailActiveTabId.get()!
    let clicks = 0
    let afterInputScripts = 0

    const runner: PreviewScriptRunner = async (code, signal) => {
      if (!clicks) {return new Function('return ' + code)()}
      afterInputScripts++

      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      )
    }

    runner.nativeAction = vi.fn(async () => ({
      success: true,
      ...(clicks
        ? kind === 'dialog'
          ? { dialogs: [pendingDialog] }
          : {
              file_chooser: {
                id: 'chooser-once',
                url: 'https://fixture.test',
                multiple: false,
                state: 'pending' as const
              }
            }
        : {})
    }))
    cleanups.push(registerPreviewScriptRunner(tabId, runner))
    cleanups.push(
      registerPreviewInput(tabId, {
        focus: () => {},
        send: event => {
          if (event.type === 'mouseUp') {clicks++}
        }
      })
    )
    let result: PreviewActResult | undefined
    void runPreviewAgentAction({ kind: 'click', selector: '#notice', tabId }, controller.signal).then(value => {
      result = value
    })
    await vi.waitFor(() => expect(result).toBeDefined())
    expect(result?.success).toBe(true)
    expect(result?.acted).toMatch(/click/i)
    expect(result?.note).toMatch(/do not repeat/i)
    expect(kind === 'dialog' ? result?.dialogs?.[0].id : result?.file_chooser?.id).toBe(`${kind}-once`)
    expect(clicks).toBe(1)
    expect(afterInputScripts).toBe(0)
  }
)

it('returns the notification receipt when a dialog opens after the initial native status check', async () => {
  const tabId = $rightRailActiveTabId.get()!
  let clicks = 0
  let statusRead = false

  const runner: PreviewScriptRunner = async (code, signal) => {
    if (!clicks) {return new Function('return ' + code)()}
    expect(statusRead).toBe(true)
    $previewWebsiteDialogs.set({ [tabId]: { dialog: pendingDialog, respond: async () => {} } })

    return new Promise((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    )
  }

  runner.nativeAction = async () => {
    statusRead = true

    return { success: true }
  }

  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  cleanups.push(
    registerPreviewInput(tabId, {
      focus: () => {},
      send: event => {
        if (event.type === 'mouseUp') {clicks++}
      }
    })
  )
  let result: PreviewActResult | undefined
  void runPreviewAgentAction({ kind: 'click', selector: '#notice', tabId }, controller.signal).then(value => {
    result = value
  })
  await vi.waitFor(() => expect(result).toBeDefined())
  expect(result).toMatchObject({ success: true, dialogs: [pendingDialog] })
  expect(result?.note).toMatch(/do not repeat/i)
  expect(clicks).toBe(1)
})

it('returns a pending dialog that opens while refreshing the post-action observation', async () => {
  const tabId = $rightRailActiveTabId.get()!
  let clicks = 0
  let observationBlocked = false

  const runner: PreviewScriptRunner = async (code, signal) => {
    if (clicks && code.includes('var holder = window.__hermesPreviewObservation')) {
      observationBlocked = true
      $previewWebsiteDialogs.set({ [tabId]: { dialog: pendingDialog, respond: async () => {} } })

      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      )
    }

    return new Function('return ' + code)()
  }

  runner.nativeAction = async () => ({ success: true })
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  cleanups.push(
    registerPreviewInput(tabId, {
      focus: () => {},
      send: event => {
        if (event.type === 'mouseUp') {
          clicks++
          document.querySelector('button')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        }
      }
    })
  )
  let result: PreviewActResult | undefined
  void runPreviewAgentAction({ kind: 'click', selector: '#notice', tabId }, controller.signal).then(value => {
    result = value
  })
  await vi.waitFor(() => expect(result).toBeDefined())
  expect(observationBlocked).toBe(true)
  expect(result).toMatchObject({ success: true, dialogs: [pendingDialog] })
  expect(result?.note).toMatch(/do not repeat/i)
  expect(clicks).toBe(1)
})

it('ignores a prior document dialog when native status is empty and another tab notifies', async () => {
  const tabId = $rightRailActiveTabId.get()!
  const oldDialog = { dialog: pendingDialog, respond: async () => {} }
  $previewWebsiteDialogs.set({ [tabId]: oldDialog })
  const runner: PreviewScriptRunner = async () => undefined
  runner.nativeAction = async () => ({ success: true })

  const receipt = await observeAfterPreviewInput(runner, undefined, controller.signal, async () => {
    $previewWebsiteDialogs.set({ [tabId]: oldDialog, other: { ...oldDialog } })

    return 'fresh observation'
  })

  expect(receipt).toEqual({ observed: 'fresh observation' })
})
