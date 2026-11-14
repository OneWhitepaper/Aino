import { atom } from 'nanostores'

import { $confirmRequest, confirm, type ConfirmRequest, settleConfirm } from '@/store/confirm'

import {
  persistPreviewHumanControl,
  storedPreviewHumanControl,
  storedPreviewHumanTabs,
  watchPreviewHumanControl
} from './preview-agent-control-storage'

export type PreviewOperationPhase = 'observing' | 'acting' | 'confirmation'
export type PreviewAgentPhase = PreviewOperationPhase | 'idle' | 'human'

interface LiveOperation {
  controller: AbortController
  phase: PreviewOperationPhase
}

// These are UI operation leases, not task execution state. A tab stays in
// human control until its visible Return to AI action is chosen.
const humanTabs = new Set(storedPreviewHumanTabs())
export const $previewAgentActivity = atom<Record<string, PreviewAgentPhase>>(
  Object.fromEntries([...humanTabs].map(tabId => [tabId, 'human' as const]))
)
const operations = new Map<string, LiveOperation>()
const epochs = new Map<string, number>()

function setActivity(tabId: string, phase: PreviewAgentPhase): void {
  if (($previewAgentActivity.get()[tabId] ?? 'idle') === phase) {
    return
  }

  const next = { ...$previewAgentActivity.get() }

  if (phase === 'idle') {
    delete next[tabId]
  } else {
    next[tabId] = phase
  }

  $previewAgentActivity.set(next)
}

export function beginPreviewOperation(
  tabId: string,
  phase: 'observing' | 'acting'
): {
  signal: AbortSignal
  setPhase: (phase: PreviewOperationPhase) => void
  release: () => void
} {
  if (storedPreviewHumanControl(tabId)) {
    applyHumanControl(tabId, true)
  }

  if (humanTabs.has(tabId)) {
    throw new Error('Browser is controlled by the user. Return control to AI to continue.')
  }

  if (operations.has(tabId)) {
    throw new Error('Browser is busy with another operation.')
  }

  const operation: LiveOperation = { controller: new AbortController(), phase }
  operations.set(tabId, operation)
  setActivity(tabId, phase)

  return {
    signal: operation.controller.signal,
    setPhase(next) {
      if (operations.get(tabId) !== operation) {
        return
      }

      operation.phase = next
      setActivity(tabId, next)
    },
    release() {
      // An old operation can settle after the user returned control and a new
      // operation began. It must not clear that new operation's status.
      if (operations.get(tabId) !== operation) {
        return
      }

      operations.delete(tabId)
      setActivity(tabId, humanTabs.has(tabId) ? 'human' : 'idle')
    }
  }
}

export function previewControlEpoch(tabId: string): number {
  return epochs.get(tabId) ?? 0
}

function applyHumanControl(tabId: string, human: boolean): void {
  if (humanTabs.has(tabId) === human) {
    return
  }

  epochs.set(tabId, previewControlEpoch(tabId) + 1)

  if (!human) {
    humanTabs.delete(tabId)
    setActivity(tabId, operations.get(tabId)?.phase ?? 'idle')

    return
  }

  humanTabs.add(tabId)
  const operation = operations.get(tabId)
  operations.delete(tabId)
  setActivity(tabId, 'human')
  operation?.controller.abort('user_takeover')
}

export function takeOverPreview(tabId: string): void {
  applyHumanControl(tabId, true)
  persistPreviewHumanControl(tabId, true)
}

export function resumePreview(tabId: string): void {
  applyHumanControl(tabId, false)
  persistPreviewHumanControl(tabId, false)
}

const stopControlSync = watchPreviewHumanControl(applyHumanControl)
import.meta.hot?.dispose(stopControlSync)

export async function confirmPreviewOperation(
  tabId: string,
  request: ConfirmRequest,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted || humanTabs.has(tabId)) {
    return false
  }

  const previous = $confirmRequest.get()
  const answer = confirm(request)
  const pending = $confirmRequest.get()

  // confirm() refuses replacement while an unrelated action is running.
  if (!pending || pending === previous) {
    return answer
  }

  const abort = () => settleConfirm(false, pending)
  signal.addEventListener('abort', abort, { once: true })

  if (signal.aborted) {
    abort()
  }

  try {
    return await answer
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
