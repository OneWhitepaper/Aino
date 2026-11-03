import { useStore } from '@nanostores/react'

import { captureSubmissionDestination } from '@/app/session/hooks/use-prompt-actions/submission-destination'
import type { SubmitTextOptions } from '@/app/session/hooks/use-prompt-actions/utils'
import { Button } from '@/components/ui/button'
import type { HermesGateway } from '@/hermes'
import { useI18n } from '@/i18n'
import { Loader2, Pause } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import { $sessionStates } from '@/store/session-states'
import { $taskPauses, claimTaskContinuation, clearTaskPause, releaseTaskContinuation } from '@/store/task-pause'

interface TaskPauseNoticeProps {
  gateway?: HermesGateway | null
  sessionId?: string | null
  profile?: string | null
  disabled: boolean
  onSubmit: (text: string, options?: SubmitTextOptions) => boolean | Promise<boolean>
}

export const TASK_CONTINUATION_TEXT =
  'Continue the paused task from preserved progress. Do not repeat completed operations. Verify uncertain side effects before retrying.'

export function TaskPauseNotice({ gateway, sessionId, profile, disabled, onSubmit }: TaskPauseNoticeProps) {
  const pauses = useStore($taskPauses)
  const { t } = useI18n()
  const key = sessionId ? gateway?.taskPauseKey?.(sessionId, profile) : null
  const pause = key ? pauses[key] : undefined

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

  return (
    <div
      className="flex min-w-0 items-center gap-2 px-1 py-1.5"
      data-slot="task-pause-notice"
      role="status"
    >
      {pause.phase === 'stopping' ? (
        <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Pause aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
        {pause.phase === 'stopping' ? t.composer.taskPausing : t.composer.taskPaused}
      </span>
      <Button
        disabled={disabled || pause.phase !== 'paused'}
        onClick={() => {
          void continueTask()
        }}
        size="xs"
        type="button"
        variant="ghost"
      >
        {t.common.continue}
      </Button>
    </div>
  )
}
