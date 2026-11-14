import type { PreviewDriveGuest } from './preview-drive-channels'
import { type PreviewInputHandle, toWebviewInputSpace } from './preview-input'

export interface PreviewApproval {
  validate: () => Promise<void>
  input: PreviewInputHandle
  release: () => Promise<void>
}

/** Keep one existing activity token from pre-approval observation through actual input. */
export async function beginPreviewApproval(guest: PreviewDriveGuest, signal?: AbortSignal): Promise<PreviewApproval> {
  const native = window.hermesDesktop

  if (!guest.getWebContentsId || !native?.beginPreviewGuestActivity || !native.endPreviewGuestActivity ||
    !native.armPreviewApproval || !native.validatePreviewApproval || !native.sendPreviewApprovedInput) {
    throw new Error('Native browser approval observation is unavailable. Use manual control.')
  }

  signal?.throwIfAborted()
  const token = await native.beginPreviewGuestActivity(guest.getWebContentsId())
  let ended = false
  let queued = Promise.resolve()
  let released: Promise<void> | undefined

  const release = () => {
    if (released) {return released}
    ended = true
    signal?.removeEventListener('abort', abort)
    released = native.endPreviewGuestActivity!(token)

    return released
  }

  const abort = () => { void release().catch(error => console.warn('Could not release browser approval', error)) }
  signal?.addEventListener('abort', abort, { once: true })

  const check = () => {
    signal?.throwIfAborted()

    if (ended) {throw new Error('Browser approval request ended')}
  }

  try {
    check()
    await native.armPreviewApproval(token)
    check()

    return {
      validate: async () => { check(); await native.validatePreviewApproval!(token); check() },
      input: {
        focus: () => { check() },
        send: input => {
          check()
          queued = queued.then(() => {
            check()

            return native.sendPreviewApprovedInput!(token, toWebviewInputSpace(input, guest.getZoomFactor?.()))
          })
          void queued.catch(() => {})
        },
        settle: () => queued
      },
      release
    }
  } catch (error) {
    await release()
    throw error
  }
}
