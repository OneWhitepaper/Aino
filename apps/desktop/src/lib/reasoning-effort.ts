import { DEFAULT_REASONING_EFFORT, isReasoningEffort, type ReasoningEffort } from '@hermes/shared'

import type { Translations } from '@/i18n/types'
import { normalize } from '@/lib/text'

/** Ultra is a mode, not just a wire level: the backend sends the route's strongest level and
 *  runs the turn as multi-agent collaboration (`agent/ultra_collaboration.py`). */
export const MULTI_AGENT_EFFORT = 'ultra'

/** Compact labels for chrome where space is tight (pill, picker rows). Menus
 *  and settings use the translated `shell.modelOptions` strings instead. */
const SHORT_LABELS: Record<string, string> = {
  none: 'Off',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra'
}

export type ReasoningEffortLabeler = (effort: string) => string

/**
 * A pick the route does not send verbatim: `ultra` is a Hermes-internal step
 * that every route clamps to its strongest level (`max` on OpenAI-compatible wires), and the
 * CLI's `/reasoning` says so ("ultra (sends max on this route)"). The wire
 * level comes from the gateway's `session.info.reasoning_effort_wire`; nothing
 * is inferred client-side, so an unknown ('' — not yet stamped, or an
 * optimistic pick) or verbatim wire reads as "no clamp".
 */
export function reasoningEffortClamp(
  effort: string,
  wire: string | undefined
): { effort: ReasoningEffort; wire: ReasoningEffort } | null {
  const picked = normalize(effort)
  const sent = normalize(wire ?? '')

  if (!sent || sent === picked || !isReasoningEffort(picked) || !isReasoningEffort(sent)) {
    return null
  }

  return { effort: picked, wire: sent }
}

/** Compact label; a clamped pick shows both ends ("Max→XHigh") so the pill
 *  never presents a Hermes step as a wire level the route does not have. Ultra
 *  keeps its own name: it is a mode, and `reasoningEffortNote` states what it sends. */
export function reasoningEffortLabel(
  effort: string,
  wireOrLabeler?: string | ReasoningEffortLabeler,
  labeler?: ReasoningEffortLabeler
): string {
  const wire = typeof wireOrLabeler === 'string' ? wireOrLabeler : undefined
  const localize = typeof wireOrLabeler === 'function' ? wireOrLabeler : labeler
  const key = normalize(effort)
  const clamp = reasoningEffortClamp(effort, wire)

  if (clamp && clamp.effort !== MULTI_AGENT_EFFORT) {
    return `${localize?.(clamp.effort) ?? SHORT_LABELS[clamp.effort]}→${localize?.(clamp.wire) ?? SHORT_LABELS[clamp.wire]}`
  }

  return key ? (localize?.(key) ?? SHORT_LABELS[key] ?? effort) : ''
}

/** Parenthetical for an effort choice: Ultra names its multi-agent mode (plus the level it
 *  sends, once the gateway has stamped it); any other clamped pick names the level sent. */
export function reasoningEffortNote(
  effort: string,
  wire: string | undefined,
  copy: Translations['shell']['modelOptions']
): string | null {
  const clamp = reasoningEffortClamp(effort, wire)

  if (normalize(effort) === MULTI_AGENT_EFFORT) {
    return clamp ? copy.multiAgentSends(copy[clamp.wire]) : copy.multiAgent
  }

  return clamp ? copy.sendsOnRoute(copy[clamp.wire]) : null
}

/** Thinking is on unless a level explicitly says otherwise; an empty value
 *  means "inherit", so it resolves through `fallback` first. */
export const isThinkingEnabled = (effort: string, fallback: string = DEFAULT_REASONING_EFFORT): boolean =>
  normalize(effort || fallback) !== 'none'

/** The level a scale control should show. Empty inherits `fallback`; `none`
 *  (thinking off) selects nothing; anything unrecognized clamps to the default. */
export function resolveReasoningEffort(effort: string, fallback: string = DEFAULT_REASONING_EFFORT): string {
  const value = normalize(effort || fallback)

  if (value === 'none') {
    return ''
  }

  return isReasoningEffort(value) ? value : DEFAULT_REASONING_EFFORT
}
