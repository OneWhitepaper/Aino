import { afterEach, expect, it, vi } from 'vitest'

import { $confirmRequest, settleConfirm } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import { runPreviewNativeFeatureAction } from './preview-native-features'
import {
  invalidatePreviewScriptRunner,
  type PreviewScriptRunner,
  registerPreviewScriptRunner
} from './preview-script-runner'

const cleanups: Array<() => void> = []
afterEach(() => {
  settleConfirm(false)
  cleanups.splice(0).forEach(cleanup => cleanup())
  closeRightRail()
})

it('inspects and dismisses an initial dialog while the document is loading without executing guest JavaScript', async () => {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!

  const runner = vi.fn(async () => {
    throw new Error('Guest JavaScript is suspended')
  }) as PreviewScriptRunner

  runner.nativeAction = vi.fn(async request =>
    request.action === 'dialog_status'
      ? {
          success: true,
          dialogs: [
            {
              id: 'initial',
              type: 'confirm',
              message: 'Continue?',
              url: 'https://example.com',
              sensitive: true,
              state: 'pending' as const
            }
          ]
        }
      : { success: true }
  )
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  invalidatePreviewScriptRunner(tabId)
  expect(await runPreviewNativeFeatureAction({ kind: 'dialog_status', tabId })).toMatchObject({
    success: true,
    tab_id: tabId
  })
  expect(
    await runPreviewNativeFeatureAction({ kind: 'dialog_respond', tabId, dialogId: 'initial', accept: false })
  ).toMatchObject({ success: true })
  expect(runner).not.toHaveBeenCalled()
  expect(runner.nativeAction).toHaveBeenCalledWith(
    { action: 'dialog_respond', dialogId: 'initial', accept: false, promptText: undefined },
    expect.any(AbortSignal)
  )
})

it('releases an exact prepared upload ticket when its confirmation is denied', async () => {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!
  const runner: PreviewScriptRunner = async () => undefined
  runner.nativeAction = vi.fn(async request =>
    request.action === 'upload_prepare'
      ? {
          success: true,
          ticket: 'prepared-upload',
          upload: { state: 'prepared' as const, paths: ['/fixture.txt'], filenames: ['fixture.txt'] }
        }
      : { success: true }
  )
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  const result = runPreviewNativeFeatureAction({
    kind: 'upload_files',
    chooserId: 'native-chooser',
    paths: ['/fixture.txt'],
    tabId
  })
  await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
  settleConfirm(false)
  expect(await result).toMatchObject({ success: false })
  expect(runner.nativeAction).toHaveBeenCalledWith({ action: 'upload_cancel', ticket: 'prepared-upload' })
  expect(vi.mocked(runner.nativeAction).mock.calls.some(([request]) => request.action === 'upload_commit')).toBe(false)
})

it('releases a preparation that finishes after the requesting action is aborted', async () => {
  newBrowserTab()
  const tabId = $rightRailActiveTabId.get()!
  const controller = new AbortController()
  const prepared = Promise.withResolvers<{
    success: boolean
    ticket: string
    upload: { state: 'prepared'; paths: string[]; filenames: string[] }
  }>()
  const runner: PreviewScriptRunner = async () => undefined
  runner.nativeAction = vi.fn(async request =>
    request.action === 'upload_prepare' ? prepared.promise : { success: true }
  )
  cleanups.push(registerPreviewScriptRunner(tabId, runner))
  const result = runPreviewNativeFeatureAction(
    { kind: 'upload_files', chooserId: 'native-chooser', paths: ['/fixture.txt'], tabId },
    controller.signal
  )
  await vi.waitFor(() => expect(runner.nativeAction).toHaveBeenCalled())
  controller.abort()
  prepared.resolve({
    success: true,
    ticket: 'late-upload',
    upload: { state: 'prepared', paths: ['/fixture.txt'], filenames: ['fixture.txt'] }
  })
  expect(await result).toMatchObject({ success: false })
  expect(runner.nativeAction).toHaveBeenCalledWith({ action: 'upload_cancel', ticket: 'late-upload' })
  expect($confirmRequest.get()).toBeNull()
})
