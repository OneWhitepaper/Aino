export interface TurnBilling {
  source: 'aino'
  user_id: string
  session_id: string
  turn_id: string
  status: 'pending'
  calls: Array<{ call_id: string; purpose: string }>
  calls_complete: boolean
  revision: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const LEGACY_USAGE_PURPOSES = [
  'chat',
  'title',
  'compression',
  'vision',
  'delegation',
  'other_auxiliary'
] as const

const PURPOSES = new Set<string>([
  ...LEGACY_USAGE_PURPOSES,
  'session_summary',
  'approval',
  'mcp',
  'tts_audio_tags',
  'side_question'
])

export function parseTurnBilling(value: unknown): TurnBilling | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const raw = value as Record<string, unknown>

  if (
    raw.source !== 'aino' ||
    typeof raw.user_id !== 'string' ||
    !raw.user_id ||
    raw.user_id.length > 128 ||
    typeof raw.session_id !== 'string' ||
    !UUID.test(raw.session_id) ||
    typeof raw.turn_id !== 'string' ||
    !UUID.test(raw.turn_id) ||
    !Array.isArray(raw.calls) ||
    raw.calls.length > 10000 ||
    typeof raw.calls_complete !== 'boolean' ||
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 0
  ) {
    return undefined
  }

  const calls: TurnBilling['calls'] = []
  const seen = new Set<string>()

  for (const call of raw.calls as unknown[]) {
    if (!call || typeof call !== 'object') {
      return undefined
    }

    const item = call as Record<string, unknown>

    if (
      typeof item.call_id !== 'string' ||
      !UUID.test(item.call_id) ||
      seen.has(item.call_id) ||
      typeof item.purpose !== 'string' ||
      !PURPOSES.has(item.purpose)
    ) {
      return undefined
    }

    seen.add(item.call_id)
    calls.push({ call_id: item.call_id, purpose: item.purpose })
  }

  // Runtime metadata is correlation only. Settlement comes from the platform ledger.
  return {
    source: 'aino',
    user_id: raw.user_id,
    session_id: raw.session_id,
    turn_id: raw.turn_id,
    status: 'pending',
    calls,
    calls_complete: raw.calls_complete,
    revision: raw.revision
  }
}

export function sameTurnBillingOwner(a: TurnBilling, b: TurnBilling): boolean {
  return a.user_id === b.user_id && a.session_id === b.session_id && a.turn_id === b.turn_id
}

export function turnBillingEquivalent(a?: TurnBilling, b?: TurnBilling): boolean {
  return (
    a === b ||
    Boolean(
      a &&
      b &&
      sameTurnBillingOwner(a, b) &&
      a.revision === b.revision &&
      a.calls_complete === b.calls_complete &&
      a.calls.length === b.calls.length &&
      a.calls.every((call, index) => call.call_id === b.calls[index].call_id && call.purpose === b.calls[index].purpose)
    )
  )
}
