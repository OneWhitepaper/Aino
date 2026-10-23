// Explicit per-upload consent; reuse Hermes collection and native Aino account upload.
// A remote gateway supplies its own redacted logs; account credentials stay in Electron.
import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import { $gateway } from '@/store/gateway'

export interface SendDiagnosticsResult {
  expiresAt?: string
  uploadId?: string
}

export interface SendDiagnosticsState {
  /** Short text describing the failure that prompted the report (attached
   *  to the bundle as error-context.txt, redacted server-side). */
  errorContext?: string
  error?: string
  phase: 'consent' | 'done' | 'error' | 'uploading'
  result?: SendDiagnosticsResult
}

export const $sendDiagnostics = atom<SendDiagnosticsState | null>(null)

// Generation token: bumped on every open AND every dismiss. An in-flight
// upload captures the generation it started under and only writes its
// completion back when the token still matches — so dismissing mid-upload is
// immediate and a stale completion can't resurrect or overwrite the dialog.
// Request cancellation stays best-effort (the WS call runs to completion
// server-side; we just ignore the result).
let generation = 0

/** Open the consent modal. No network I/O happens until the user confirms. */
export function requestSendDiagnostics(errorContext?: string): void {
  generation += 1
  $sendDiagnostics.set({ errorContext, phase: 'consent' })
}

export function dismissSendDiagnostics(): void {
  generation += 1
  $sendDiagnostics.set(null)
}

interface CollectResponse {
  ok: boolean
  bundle_base64?: string
  error?: string
}

/** Read the LOCAL desktop log via Electron so a remote backend's bundle still
 *  carries the Desktop-side transport evidence. Best-effort: absence of the
 *  IPC (browser dashboard, older shells) just omits the file. */
async function collectLocalExtras(): Promise<Record<string, string>> {
  try {
    const logs = await window.hermesDesktop?.getRecentLogs?.()
    const lines = Array.isArray(logs?.lines) ? logs.lines : []

    return lines.length ? { 'desktop.log': lines.join('\n') } : {}
  } catch {
    return {}
  }
}

// Bundle collection + upload legitimately takes a while (log reads + gzip +
// upload); the default WS timeout is too tight for slow disks/links.
const SHARE_TIMEOUT_MS = 120_000

/** User confirmed — run the upload. Transitions consent → uploading → done/error. */
export async function confirmSendDiagnostics(): Promise<void> {
  const current = $sendDiagnostics.get()

  if (!current || current.phase !== 'consent') {
    return
  }

  const startedGeneration = generation

  // Only write back while the dialog the upload belongs to is still open.
  const stillCurrent = () => generation === startedGeneration

  $sendDiagnostics.set({ ...current, phase: 'uploading' })

  try {
    const gateway = $gateway.get()

    if (!gateway) {
      throw new Error(translateNow('sendDiagnostics.gatewayUnavailable'))
    }

    const diagnostics = window.hermesDesktop?.platformDiagnostics

    if (!diagnostics) {
      throw new Error(translateNow('sendDiagnostics.uploadFailed'))
    }

    const owner = await diagnostics.scope()

    if (!stillCurrent()) { return }

    const extraFiles = await collectLocalExtras()

    if (!stillCurrent()) {
      return
    }

    const response = await gateway.request<CollectResponse>(
      'diagnostics.collect',
      {
        ...(current.errorContext ? { error_context: current.errorContext } : {}),
        ...(Object.keys(extraFiles).length ? { extra_files: extraFiles } : {})
      },
      SHARE_TIMEOUT_MS
    )

    if (!stillCurrent()) {
      return
    }

    if (!response.ok || !response.bundle_base64) {
      throw new Error(response.error || translateNow('sendDiagnostics.uploadFailed'))
    }

    const receipt = await diagnostics.upload({
      bundle_base64: response.bundle_base64,
      expected_user_id: owner.user_id,
      expected_generation: owner.generation
    })

    if (!stillCurrent()) { return }

    $sendDiagnostics.set({
      ...current,
      phase: 'done',
      result: {
        expiresAt: receipt.expires_at,
        uploadId: receipt.id
      }
    })
  } catch (error) {
    if (!stillCurrent()) {
      return
    }

    $sendDiagnostics.set({
      ...current,
      error: error instanceof Error ? error.message : String(error),
      phase: 'error'
    })
  }
}
