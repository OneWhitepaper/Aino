import type { ChatMessage } from './types'

const MODEL_SELECTION_ERRORS = new Set(['managed_model_access_denied', 'model_not_found', 'model_unavailable'])

export function isModelSelectionError(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    Boolean(message.error) &&
    MODEL_SELECTION_ERRORS.has(message.errorSurface?.code ?? '')
  )
}

function successfulReply(message: ChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    !message.error &&
    !message.pending &&
    !message.interim &&
    !message.interrupted &&
    !message.hidden &&
    message.parts.some(part => (part.type === 'text' && Boolean(part.text.trim())) || part.type === 'image')
  )
}

/** Renderer-only recovery; the stored failed turn and its partial output stay intact. */
export function modelErrorRecoveryReasons(
  messages: ChatMessage[]
): Map<string, NonNullable<ChatMessage['errorResolved']>> {
  const reasons = new Map<string, NonNullable<ChatMessage['errorResolved']>>()
  let replied = false
  let switched = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (isModelSelectionError(message) && (message.errorResolved || replied || switched)) {
      reasons.set(message.id, message.errorResolved ?? (replied ? 'reply_received' : 'model_changed'))
    }

    replied ||= successfulReply(message)
    // This marker is emitted by the gateway only after the agent swap commits,
    // including managed credential binding. Picker paint and rejected switches
    // never create it, so it also proves recovery after a cold history read.
    switched ||= Boolean(
      message.modelSwitch?.model && message.modelSwitch.provider && message.modelSwitch.previous_model
    )
  }

  return reasons
}

/** Capture before the optimistic paint. A new failure during the switch is never acknowledged. */
export function captureModelErrors(messages: ChatMessage[]): ChatMessage[] {
  const start = messages.findLastIndex(successfulReply) + 1

  return messages.slice(start).filter(message => isModelSelectionError(message) && !message.errorResolved)
}

export function resolveCapturedModelErrors(messages: ChatMessage[], captured: ChatMessage[]): ChatMessage[] {
  let changed = false

  const next = messages.map(message => {
    const failure = captured.find(
      candidate =>
        candidate.id === message.id &&
        (candidate.rowId === undefined || message.rowId === undefined || candidate.rowId === message.rowId) &&
        candidate.error === message.error &&
        candidate.errorSurface?.code === message.errorSurface?.code &&
        candidate.timestamp === message.timestamp
    )

    if (!failure || message.errorResolved) {
      return message
    }

    changed = true

    return { ...message, errorResolved: 'model_changed' as const }
  })

  return changed ? next : messages
}
