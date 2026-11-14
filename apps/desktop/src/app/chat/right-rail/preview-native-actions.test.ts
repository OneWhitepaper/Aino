import { afterEach, expect, it, vi } from 'vitest'

import type { PreviewBrowserDialog } from '../../../../shared/preview-browser-interactions'

import type { PreviewDriveGuest } from './preview-drive-channels'
import { $previewWebsiteDialogs, installPreviewNativeActions } from './preview-native-actions'
import type { PreviewScriptRunner } from './preview-script-runner'

const originalDesktop = window.hermesDesktop
const lifetimes: AbortController[] = []
afterEach(() => {
  lifetimes.splice(0).forEach(lifetime => lifetime.abort())
  window.hermesDesktop = originalDesktop
  $previewWebsiteDialogs.set({})
})

it('hydrates a missed startup dialog and preserves a replacement prompt opened while responding', async () => {
  const first: PreviewBrowserDialog = {
    id: 'first',
    type: 'prompt',
    message: 'Name',
    url: 'https://example.com',
    sensitive: false,
    state: 'pending'
  }

  const second: PreviewBrowserDialog = { ...first, id: 'second', message: 'Next name' }
  let notify!: (event: { webContentsId: number; scope: string; dialog: PreviewBrowserDialog }) => void

  const bridge = vi.fn(async (_id, request) => {
    if (request.action === 'dialog_manual') {
      notify({ webContentsId: 72, scope: 'startup', dialog: second })
    }

    return { success: true, dialogs: [first, second] }
  })

  window.hermesDesktop = {
    ...originalDesktop,
    previewBrowserInteraction: bridge,
    onPreviewBrowserDialog: listener => {
      notify = listener

      return () => {}
    }
  }
  const guest = Object.assign(new EventTarget(), { getWebContentsId: () => 72 }) as PreviewDriveGuest
  const runner: PreviewScriptRunner = async () => undefined
  const lifetime = new AbortController()
  lifetimes.push(lifetime)
  installPreviewNativeActions(runner, () => guest, 'startup', lifetime.signal)
  await vi.waitFor(() => expect($previewWebsiteDialogs.get().startup?.dialog.id).toBe('first'))
  await $previewWebsiteDialogs.get().startup.respond(true, 'typed name')
  expect($previewWebsiteDialogs.get().startup.dialog.id).toBe('second')
  notify({ webContentsId: 72, scope: 'startup', dialog: { ...first, state: 'accepted' } })
  expect($previewWebsiteDialogs.get().startup.dialog.id).toBe('second')
})
