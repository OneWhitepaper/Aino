import { captureModelErrors, resolveCapturedModelErrors } from '@/lib/chat-messages/model-error-recovery'
import { $messages, setMessages } from '@/store/session'
import { $sessionStates, sessionTileDelegate } from '@/store/session-states'

/** Acknowledgement belongs to the errors present when this switch began. */
export function captureSessionModelErrorRecovery(
  sessionId: string | null,
  current: () => boolean,
  canPaintPrimary: () => boolean,
  tileExists: () => boolean
) {
  const failedModels = captureModelErrors(sessionId ? ($sessionStates.get()[sessionId]?.messages ?? []) : [])

  return () => {
    if (!current() || !sessionId || !failedModels.length) {
      return
    }

    // The cache's reconciliation also reads this primary mirror.
    if (canPaintPrimary()) {
      setMessages(resolveCapturedModelErrors($messages.get(), failedModels))
    }

    if (tileExists()) {
      sessionTileDelegate()?.updateSession(sessionId, state => ({
        ...state,
        messages: resolveCapturedModelErrors(state.messages, failedModels)
      }))
    }
  }
}
