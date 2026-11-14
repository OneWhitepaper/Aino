import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { group } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'
import { $confirmRequest, runConfirm, settleConfirm } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'
import type * as WindowsModule from '@/store/windows'

import { runPreviewAgentAction } from './preview-agent'
import { registerPreviewInput } from './preview-input'
import { readActivePreview, registerPreviewPageReader } from './preview-reader'
import { type PreviewScriptRunner, registerPreviewScriptRunner } from './preview-script-runner'

const windowRole = vi.hoisted(() => ({ browser: false, tabId: '' }))
vi.mock('@/store/windows', async importOriginal => ({
  ...(await importOriginal<typeof WindowsModule>()),
  isBrowserWindow: () => windowRole.browser,
  windowBrowserTabId: () => windowRole.tabId
}))

const cleanups: Array<() => void> = []
const send = vi.fn()

function browser() {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!
  const runner: PreviewScriptRunner = async code => await new Function('return ' + code)()
  runner.beginApproval = async () => ({
    validate: async () => {},
    input: { focus: () => {}, send },
    release: async () => {}
  })
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  cleanups.push(registerPreviewInput(tabId, { focus: () => {}, send }))
  cleanups.push(
    registerPreviewPageReader(tabId, async () => ({ text: 'Visible page text', title: 'Page', url: location.href }))
  )

  return tabId
}

const show = (tabId: string, visible: boolean) =>
  $layoutTree.set(group(['files', `preview-tile:${tabId}`], { active: visible ? `preview-tile:${tabId}` : 'files' }))

beforeEach(() => {
  send.mockReset()
  windowRole.browser = false
  document.body.innerHTML = '<button id="safe">Preview</button><button id="pay">Pay now</button>'
})

afterEach(() => {
  settleConfirm(false)
  cleanups.splice(0).forEach(cleanup => cleanup())
  $layoutTree.set(null)
  closeRightRail()
  document.body.replaceChildren()
})

it('refuses hidden-browser input while Files is selected without blocking reads or visible browser actions', async () => {
  const tabId = browser()
  show(tabId, false)

  const hidden = await runPreviewAgentAction({ kind: 'click', selector: '#safe', tabId })
  expect(hidden).toMatchObject({ error: expect.stringContaining('desktop_preview'), success: false })
  expect(send).not.toHaveBeenCalled()
  expect((await readActivePreview())?.text).toBe('Visible page text')

  show(tabId, true)
  await runPreviewAgentAction({ kind: 'click', selector: '#safe', tabId })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown' }))

  show(tabId, false)
  windowRole.browser = true
  windowRole.tabId = tabId
  send.mockReset()
  await runPreviewAgentAction({ kind: 'click', selector: '#safe', tabId })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouseDown' }))
})

it('retires an approved operation after the user hides its browser, even if they show it again before approving', async () => {
  const tabId = browser()
  show(tabId, true)
  const action = runPreviewAgentAction({ kind: 'click', selector: '#pay', tabId })
  await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
  show(tabId, false)
  show(tabId, true)
  await runConfirm($confirmRequest.get()!)

  expect(await action).toMatchObject({ error: expect.stringContaining('desktop_preview'), success: false })
  expect(send.mock.calls.every(([event]) => event.type === 'mouseMove')).toBe(true)
})
