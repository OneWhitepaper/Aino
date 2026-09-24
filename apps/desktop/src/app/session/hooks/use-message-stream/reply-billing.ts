import type { ClientSessionState, PendingReplyBilling } from '@/app/types'
import { parseTurnBilling, sameTurnBillingOwner } from '@/lib/turn-billing'

function applyReceipt(state: ClientSessionState, update: PendingReplyBilling): ClientSessionState | undefined {
  const { billing } = update
  const index = state.messages.findIndex(message => message.turnMetrics?.billing?.turn_id === billing.turn_id)

  if (index < 0) {
    return undefined
  }
  const message = state.messages[index]
  const current = message.turnMetrics!.billing!

  if (!sameTurnBillingOwner(current, billing) || current.revision > billing.revision) {
    return state
  }

  if (
    current.revision === billing.revision &&
    (!update.nonAinoModelCalls || message.turnMetrics?.non_aino_model_calls)
  ) {
    return state
  }

  const messages = state.messages.slice()
  messages[index] = {
    ...message,
    turnMetrics: {
      ...message.turnMetrics,
      billing: current.revision === billing.revision ? current : billing,
      ...(update.nonAinoModelCalls ? { non_aino_model_calls: true as const } : {})
    }
  }

  return { ...state, messages }
}

export function receiveReplyBilling(
  state: ClientSessionState,
  raw: unknown,
  nonAinoModelCalls = false
): ClientSessionState {
  const billing = parseTurnBilling(raw)

  if (!billing) {
    return state
  }

  const update: PendingReplyBilling = {
    billing,
    ...(nonAinoModelCalls ? { nonAinoModelCalls: true } : {})
  }

  const applied = applyReceipt(state, update)

  if (applied) {
    return applied
  }
  const previous = state.pendingReplyBilling?.[billing.turn_id]

  if (
    previous &&
    (!sameTurnBillingOwner(previous.billing, billing) ||
      previous.billing.revision > billing.revision ||
      (previous.billing.revision === billing.revision && (!update.nonAinoModelCalls || previous.nonAinoModelCalls)))
  ) {
    return state
  }

  // A title can finish between persisting a reply and publishing message.complete.

  const pending = {
    ...state.pendingReplyBilling,
    [billing.turn_id]: {
      ...update,
      ...(previous?.nonAinoModelCalls ? { nonAinoModelCalls: true as const } : {})
    }
  }

  return { ...state, pendingReplyBilling: Object.fromEntries(Object.entries(pending).slice(-32)) }
}

export function flushReplyBilling(state: ClientSessionState): ClientSessionState {
  let next = state

  for (const [turn, update] of Object.entries(state.pendingReplyBilling ?? {})) {
    const applied = applyReceipt(next, update)

    if (!applied) {
      continue
    }
    const pending = { ...applied.pendingReplyBilling }
    delete pending[turn]
    next = { ...applied, pendingReplyBilling: pending }
  }

  return next
}
