import { captureSubmissionDestination } from '@/app/session/hooks/use-prompt-actions/submission-destination'
import type { SubmitTextOptions } from '@/app/session/hooks/use-prompt-actions/utils'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { notifyError } from '@/store/notifications'
import { $sessionStates } from '@/store/session-states'
import { $taskPauses, claimTaskContinuation, clearTaskPause, releaseTaskContinuation } from '@/store/task-pause'

interface UseTaskContinuationProps {
  gateway?: HermesGateway | null
  sessionId?: string | null
  profile?: string | null
  onSubmit: (text: string, options?: SubmitTextOptions) => boolean | Promise<boolean>
}

export const TASK_CONTINUATION_TEXT =
  'Continue the paused task from preserved progress. Do not repeat completed operations. Verify uncertain side effects before retrying.'

export interface TaskContinuationControl {
  phase: 'stopping' | 'paused' | 'continuing'
  resume: () => Promise<void>
}

export function useTaskContinuation({
  gateway,
  sessionId,
  profile,
  onSubmit
}: UseTaskContinuationProps): TaskContinuationControl | null {
  const { t } = useI18n()
  const key = sessionId ? gateway?.taskPauseKey?.(sessionId, profile) : null
  const pause = useStoreSelector($taskPauses, pauses => (key ? pauses[key] : undefined))

  if (!pause || !key || !sessionId || !gateway) {
    return null
  }

  const continueTask = async () => {
    const continuation = claimTaskContinuation(key)

    if (!continuation) {
      return
    }

    const request = gateway.request.bind(gateway)

    try {
      const accepted = await onSubmit(TASK_CONTINUATION_TEXT, {
        sessionId,
        storedSessionId: $sessionStates.get()[sessionId]?.storedSessionId ?? sessionId,
        destination: captureSubmissionDestination(sessionId, request),
        submission_id: `continue:${continuation.admission_id}:${continuation.execution_generation}`,
        displayKind: 'hidden',
        attachments: [],
        continuationOf: continuation
      })

      if (accepted) {
        clearTaskPause(key, continuation)
      } else {
        releaseTaskContinuation(key, continuation)
      }
    } catch (error) {
      releaseTaskContinuation(key, continuation)
      notifyError(error, t.desktop.stopFailed)
    }
  }

  return { phase: pause.phase, resume: continueTask }
}
