import { getRuntimeI18nLocale } from '@/i18n/runtime'
import type { PreviewActAction, PreviewActResult } from '@/lib/preview-act/types'
import type { PreviewOwner } from '@/store/preview-ownership'

import type {
  PreviewBrowserInteractionRequest,
  PreviewBrowserInteractionResult
} from '../../../../shared/preview-browser-interactions'

import { beginPreviewOperation, confirmPreviewOperation } from './preview-agent-control'
import { previewAgentCopy } from './preview-agent-i18n'
import { bindPreviewTarget } from './preview-agent-observation'
import { resolveActivePreviewNativeRunner, resolveActivePreviewScriptRunner } from './preview-script-runner'
import { resolvePreviewUploadTarget } from './preview-upload-target'

type Action = Omit<PreviewActAction, 'kind'> & { kind: string }
interface NativeContext {
  action: Action
  owner?: PreviewOwner
  signal: AbortSignal
  guard: () => void
  native: (request: Omit<PreviewBrowserInteractionRequest, 'scope'>) => Promise<PreviewBrowserInteractionResult>
  cancelUpload: (ticket: string) => Promise<void>
  approve: (details: { label: string; value: string }[]) => Promise<void>
}

async function respondDialog({ action, native, approve }: NativeContext): Promise<PreviewActResult> {
  const current = await native({ action: 'dialog_status' })
  const dialog = current.dialogs?.find(item => item.id === action.dialogId && item.state === 'pending')

  if (!dialog || typeof action.accept !== 'boolean') {
    throw new Error('The named website dialog is no longer pending')
  }

  if (action.accept && dialog.sensitive && dialog.type === 'prompt') {
    throw new Error('Enter sensitive text directly in the website dialog. The agent cannot supply it.')
  }

  if (action.accept && dialog.type !== 'alert') {
    await approve([
      { label: 'Website', value: dialog.url },
      { label: 'Dialog', value: dialog.message },
      ...(action.promptText === undefined ? [] : [{ label: 'Response', value: action.promptText }])
    ])
  }

  return native({
    action: 'dialog_respond',
    dialogId: action.dialogId,
    accept: action.accept,
    promptText: action.promptText
  })
}

async function uploadFiles({
  action,
  native,
  approve,
  signal,
  owner,
  guard,
  cancelUpload
}: NativeContext): Promise<PreviewActResult> {
  const label = action.chooserId ? undefined : await resolvePreviewUploadTarget(action, signal, owner, guard)
  const prepared = await native({ action: 'upload_prepare', paths: action.paths, chooserId: action.chooserId })

  if (!prepared.ticket || !prepared.upload) {
    throw new Error(prepared.error ?? 'Upload target is unavailable')
  }

  try {
    await approve([
      { label: 'Website', value: prepared.url ?? '' },
      ...(label ? [{ label: 'Upload target', value: label }] : []),
      { label: 'Upload files', value: prepared.upload.paths.join('\n') }
    ])

    return await native({ action: 'upload_commit', ticket: prepared.ticket })
  } finally {
    await cancelUpload(prepared.ticket)
  }
}

async function downloadStatus({ action, native, approve }: NativeContext): Promise<PreviewActResult> {
  if (action.downloadPath) {
    const prepared = await native({ action: 'download_prepare', downloadPath: action.downloadPath })

    if (!prepared.ticket || !prepared.download_path) {
      throw new Error(prepared.error ?? 'Download destination is unavailable')
    }

    await approve([
      { label: 'Website', value: prepared.url ?? '' },
      { label: 'Save next download', value: prepared.download_path }
    ])
    await native({ action: 'download_commit', ticket: prepared.ticket })
  }

  return native({ action: 'downloads_status' })
}

const handlers: Record<string, (context: NativeContext) => Promise<PreviewActResult>> = {
  dialog_status: ({ native }) => native({ action: 'dialog_status' }),
  dialog_respond: respondDialog,
  upload_files: uploadFiles,
  downloads_status: downloadStatus,
  download_cancel: ({ action, native }) => native({ action: 'download_cancel', downloadId: action.downloadId })
}

/** Native dialog/status handling remains reachable before dom-ready and while guest JavaScript pauses. */
export async function runPreviewNativeFeatureAction(
  action: Action,
  outerSignal?: AbortSignal,
  owner?: PreviewOwner
): Promise<PreviewActResult> {
  const nativeOnly = action.kind !== 'upload_files' || Boolean(action.chooserId)
  const binding = nativeOnly ? resolveActivePreviewNativeRunner(owner) : resolveActivePreviewScriptRunner(owner)

  if (!binding?.runner.nativeAction) {
    return { success: false, error: 'Native browser operations are unavailable. Update the desktop app.' }
  }

  const readOnly = action.kind === 'dialog_status' || (action.kind === 'downloads_status' && !action.downloadPath)
  const target = bindPreviewTarget(binding, owner, !readOnly, nativeOnly)
  let operation: ReturnType<typeof beginPreviewOperation> | undefined

  try {
    target.validate()

    if (action.tabId && action.tabId !== binding.tabId) {
      throw new Error('The requested browser tab is no longer selected')
    }

    binding.runner.setNativeAuthority?.(owner)
    operation = beginPreviewOperation(binding.tabId, readOnly ? 'observing' : 'acting')
    const signal = outerSignal ? AbortSignal.any([outerSignal, operation.signal]) : operation.signal

    const guard = () => {
      signal.throwIfAborted()
      target.validate()
    }

    const native: NativeContext['native'] = async request => {
      guard()
      const result = await binding.runner.nativeAction!(request, signal)

      try {
        guard()
      } catch (error) {
        if (request.action === 'upload_prepare' && result.ticket) {
          await binding.runner.nativeAction!({ action: 'upload_cancel', ticket: result.ticket }).catch(releaseError =>
            console.warn('Could not release Browser upload authorization', releaseError)
          )
        }

        throw error
      }

      return result
    }

    const approve: NativeContext['approve'] = async details => {
      operation!.setPhase('confirmation')
      const copy = previewAgentCopy(getRuntimeI18nLocale())

      const accepted = await confirmPreviewOperation(
        binding.tabId,
        {
          title: copy.confirmTitle,
          description: copy.confirmDescription,
          confirmLabel: copy.allowLabel,
          details
        },
        signal
      )

      guard()
      operation!.setPhase('acting')

      if (!accepted) {
        throw new Error(copy.deniedText)
      }
    }

    const handler = handlers[action.kind]

    if (!handler) {
      throw new Error('Unknown native browser operation')
    }

    return {
      ...(await handler({
        action,
        owner,
        signal,
        guard,
        native,
        approve,
        cancelUpload: async ticket => {
          await binding.runner.nativeAction!({ action: 'upload_cancel', ticket }).catch(error =>
            console.warn('Could not release Browser upload authorization', error)
          )
        }
      })),
      tab_id: binding.tabId
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    operation?.release()
    target.release()
  }
}
