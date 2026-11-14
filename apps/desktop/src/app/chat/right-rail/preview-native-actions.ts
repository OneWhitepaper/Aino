import { atom } from 'nanostores'

import { ownerIdentity } from '@/store/preview-ownership'
import { $activeProfile } from '@/store/profile'
import { $focusedStoredSessionId } from '@/store/session-focus'

import type { PreviewBrowserDialog, PreviewBrowserFileChooser } from '../../../../shared/preview-browser-interactions'

import { $previewAgentActivity, previewControlEpoch } from './preview-agent-control'
import type { PreviewDriveGuest } from './preview-drive-channels'
import type { PreviewScriptRunner } from './preview-script-runner'

interface PendingDialog {
  defaultText?: string
  dialog: PreviewBrowserDialog
  respond: (accept: boolean, promptText?: string) => Promise<void>
}
export const $previewWebsiteDialogs = atom<Record<string, PendingDialog>>({})

interface PendingFileChooser {
  chooser: PreviewBrowserFileChooser
  choose: () => Promise<void>
  cancel: () => Promise<void>
}
export const $previewWebsiteFileChoosers = atom<Record<string, PendingFileChooser>>({})

export function clearPreviewWebsiteFileChooser(tabId: string, chooserId?: string): void {
  const pending = $previewWebsiteFileChoosers.get()[tabId]

  if (!pending || (chooserId && pending.chooser.id !== chooserId)) {
    return
  }

  const next = { ...$previewWebsiteFileChoosers.get() }
  delete next[tabId]
  $previewWebsiteFileChoosers.set(next)
}

export function clearPreviewWebsiteDialog(tabId: string, dialogId?: string): void {
  const pending = $previewWebsiteDialogs.get()[tabId]

  if (!pending || (dialogId && pending.dialog.id !== dialogId)) {
    return
  }

  const next = { ...$previewWebsiteDialogs.get() }
  delete next[tabId]
  $previewWebsiteDialogs.set(next)
}

/** Attach narrowly typed native actions to the same guest as the existing script channel. */
export function installPreviewNativeActions(
  runner: PreviewScriptRunner,
  guest: () => PreviewDriveGuest | null,
  tabId: string,
  lifetime: AbortSignal
): void {
  const bridge = window.hermesDesktop?.previewBrowserInteraction

  if (!bridge) {
    return
  }

  const scope = tabId
  let lastId: number | undefined
  let authority = ''
  let receiptRevision = 0

  runner.setNativeAuthority = owner => {
    const identity = ownerIdentity(owner === undefined ? $focusedStoredSessionId.get() : owner)
    authority = JSON.stringify({
      ...identity,
      profile: identity.profile ?? $activeProfile.get(),
      epoch: previewControlEpoch(tabId)
    })
  }

  runner.setNativeAuthority()

  runner.nativeAction = async (request, signal) => {
    signal?.throwIfAborted()
    lifetime.throwIfAborted()
    const id = guest()?.getWebContentsId?.()

    if (!Number.isSafeInteger(id)) {
      throw new Error('Native browser page is not ready')
    }

    lastId = id

    return bridge(id!, { ...request, scope, authorization: authority })
  }

  const receive = (event: {
    webContentsId: number
    scope: string
    dialog: PreviewBrowserDialog
    defaultText?: string
  }) => {
    if (lifetime.aborted || event.scope !== scope || event.webContentsId !== lastId) {
      return
    }

    receiptRevision++

    if (event.dialog.state !== 'pending') {
      clearPreviewWebsiteDialog(tabId, event.dialog.id)

      return
    }

    $previewWebsiteDialogs.set({
      ...$previewWebsiteDialogs.get(),
      [tabId]: {
        dialog: event.dialog,
        defaultText: event.defaultText,
        async respond(accept, promptText) {
          await runner.nativeAction!({ action: 'dialog_manual', dialogId: event.dialog.id, accept, promptText })
          clearPreviewWebsiteDialog(tabId, event.dialog.id)
        }
      }
    })
  }

  const receiveChooser = (event: { webContentsId: number; scope: string; chooser: PreviewBrowserFileChooser }) => {
    if (lifetime.aborted || event.scope !== scope || event.webContentsId !== lastId) {
      return
    }

    receiptRevision++

    if (event.chooser.state !== 'pending') {
      clearPreviewWebsiteFileChooser(tabId, event.chooser.id)

      return
    }

    $previewWebsiteFileChoosers.set({
      ...$previewWebsiteFileChoosers.get(),
      [tabId]: {
        chooser: event.chooser,
        async choose() {
          await runner.nativeAction!({ action: 'chooser_manual', chooserId: event.chooser.id })
          clearPreviewWebsiteFileChooser(tabId, event.chooser.id)
        },
        async cancel() {
          await runner.nativeAction!({ action: 'chooser_cancel', chooserId: event.chooser.id })
          clearPreviewWebsiteFileChooser(tabId, event.chooser.id)
        }
      }
    })
  }

  const stop = window.hermesDesktop.onPreviewBrowserDialog?.(receive)
  const stopChooser = window.hermesDesktop.onPreviewFileChooser?.(receiveChooser)

  const hydrate = () => {
    const revision = receiptRevision
    const previousDialog = $previewWebsiteDialogs.get()[tabId]?.dialog.id
    const previousChooser = $previewWebsiteFileChoosers.get()[tabId]?.chooser.id
    void runner.nativeAction!({ action: 'dialog_status' })
      .then(async result => {
        if (revision !== receiptRevision) {
          return
        }
        const dialog = result.dialogs?.find(item => item.state === 'pending')

        if (dialog && lastId !== undefined) {
          const privateStatus = await runner.nativeAction!({ action: 'dialog_manual_status', dialogId: dialog.id })

          if (revision !== receiptRevision) {
            return
          }
          receive({ webContentsId: lastId, scope, dialog, defaultText: privateStatus.default_text })
        }

        if (!dialog && previousDialog) {
          clearPreviewWebsiteDialog(tabId, previousDialog)
        }

        if (!result.file_chooser && previousChooser) {
          clearPreviewWebsiteFileChooser(tabId, previousChooser)
        }

        if (result.file_chooser && lastId !== undefined) {
          receiveChooser({ webContentsId: lastId, scope, chooser: result.file_chooser })
        }
      })
      .catch(() => undefined)
  }

  const current = guest()
  current?.addEventListener('did-start-loading', hydrate)
  current?.addEventListener('dom-ready', hydrate)
  hydrate()

  const revoke = () => {
    runner.setNativeAuthority?.()

    if (lastId !== undefined) {
      void bridge(lastId, { action: 'revoke', scope, authorization: authority }).catch(() => undefined)
    }
  }

  const stopControl = $previewAgentActivity.listen(state => {
    if (state[tabId] === 'human') {
      revoke()
    }
  })

  const stopSession = $focusedStoredSessionId.listen(revoke)
  const stopProfile = $activeProfile.listen(revoke)

  lifetime.addEventListener(
    'abort',
    () => {
      stop?.()
      stopChooser?.()
      stopControl()
      stopSession()
      stopProfile()
      current?.removeEventListener('did-start-loading', hydrate)
      current?.removeEventListener('dom-ready', hydrate)
      clearPreviewWebsiteDialog(tabId)
      clearPreviewWebsiteFileChooser(tabId)

      if (lastId !== undefined) {
        void bridge(lastId, { action: 'release', scope }).catch(() => undefined)
      }
    },
    { once: true }
  )
}
