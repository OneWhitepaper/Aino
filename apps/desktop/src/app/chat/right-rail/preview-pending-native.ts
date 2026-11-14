import type { PreviewActResult } from '@/lib/preview-act/types'
import type { PreviewOwner } from '@/store/preview-ownership'

import { activePreviewTabFor } from './preview-active-tab'
import { $previewWebsiteDialogs, $previewWebsiteFileChoosers } from './preview-native-actions'
import type { PreviewScriptRunner } from './preview-script-runner'

export function hasPendingPreviewNative(result: PreviewActResult): boolean {
  return Boolean(result.dialogs?.some(dialog => dialog.state === 'pending') || result.file_chooser?.state === 'pending')
}

function pendingReceipt(result: PreviewActResult): PreviewActResult | null {
  if (!hasPendingPreviewNative(result)) {
    return null
  }

  return {
    success: true,
    url: result.url,
    dialogs: result.dialogs?.filter(dialog => dialog.state === 'pending'),
    file_chooser: result.file_chooser?.state === 'pending' ? result.file_chooser : undefined,
    note:
      result.note ??
      'The action opened a native dialog or file chooser. Do not repeat the action. Use dialog_status and respond to the pending request before continuing.'
  }
}

/** Reuse the native status channel and its existing UI notifications: guest JS
 * is suspended by alert/confirm/prompt and cannot verify its own blocking dialog. */
export async function observeAfterPreviewInput<T>(
  runner: PreviewScriptRunner,
  owner: PreviewOwner | undefined,
  signal: AbortSignal | undefined,
  observe: (signal?: AbortSignal) => Promise<T>
): Promise<{ pending: PreviewActResult } | { observed: T }> {
  if (!runner.nativeAction) {
    return { observed: await observe(signal) }
  }

  signal?.throwIfAborted()
  const controller = new AbortController()
  const live = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const tabId = activePreviewTabFor(owner)?.id
  const prompt = Promise.withResolvers<PreviewActResult>()
  const previousDialog = tabId && $previewWebsiteDialogs.get()[tabId]
  const previousChooser = tabId && $previewWebsiteFileChoosers.get()[tabId]

  const inspect = () => {
    const dialog = tabId && $previewWebsiteDialogs.get()[tabId]
    const chooser = tabId && $previewWebsiteFileChoosers.get()[tabId]

    const result = pendingReceipt({
      success: true,
      dialogs: dialog && dialog !== previousDialog ? [dialog.dialog] : undefined,
      file_chooser: chooser && chooser !== previousChooser ? chooser.chooser : undefined
    })

    if (result) {
      prompt.resolve(result)
    }

    return result
  }

  const stops = [$previewWebsiteDialogs.listen(inspect), $previewWebsiteFileChoosers.listen(inspect)]

  try {
    const status = await runner.nativeAction({ action: 'dialog_status' }, live)
    const pending = pendingReceipt(status)

    if (pending) {
      return { pending }
    }

    const result = await Promise.race([
      prompt.promise.then(pending => ({ pending })),
      observe(live).then(observed => ({ observed }))
    ])

    return result
  } finally {
    stops.forEach(stop => stop())
    controller.abort()
  }
}
