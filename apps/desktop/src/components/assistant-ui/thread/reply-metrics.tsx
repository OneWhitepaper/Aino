import { compactNumber } from '@hermes/shared'
import { useContext } from 'react'

import { formatElapsed } from '@/components/chat/activity-timer'
import { useI18n } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import type { TurnMetrics } from '@/lib/turn-metrics'

import { ReplyCost } from './reply-cost'
import { ResponseProcess } from './response-group'

interface ReplyMetricsProps {
  metrics?: TurnMetrics
  durationS?: number
}

export function ReplyMetrics({ metrics, durationS }: ReplyMetricsProps) {
  const { t } = useI18n()
  const process = useContext(ResponseProcess)
  const copy = t.assistant.thread.replyMetrics
  const duration = metrics?.duration_s ?? durationS
  const durationInProcessHeader = process.enabled && !!process.answerMessageId && durationS !== undefined

  const items = [
    duration !== undefined && !durationInProcessHeader
      ? `${copy.duration} ${formatElapsed(Math.round(duration))}`
      : null,
    metrics?.total_tokens !== undefined ? `${copy.tokens} ${compactNumber(metrics.total_tokens)} token` : null,
    metrics?.context_percent !== undefined
      ? `${copy.context} ${metrics.context_estimated ? '~' : ''}${Math.round(metrics.context_percent)}%`
      : null,
    metrics?.tokens_per_second !== undefined ? `${Math.round(metrics.tokens_per_second)} token/s` : null,
    metrics?.cache_hit_pct !== undefined ? `${copy.cache} ${Math.round(metrics.cache_hit_pct)}%` : null
  ].filter((item): item is string => item !== null)

  const details = [
    metrics?.session_elapsed_s !== undefined
      ? `${copy.sessionElapsed} ${formatElapsed(Math.round(metrics.session_elapsed_s))}`
      : null,
    metrics?.input_tokens !== undefined ? `${copy.input} ${compactNumber(metrics.input_tokens)} token` : null,
    metrics?.output_tokens !== undefined ? `${copy.output} ${compactNumber(metrics.output_tokens)} token` : null,
    metrics?.context_used !== undefined && metrics.context_max !== undefined
      ? `${copy.context} ${compactNumber(metrics.context_used)} / ${compactNumber(metrics.context_max)}`
      : null
  ].filter((item): item is string => item !== null)

  if (!items.length && !details.length && !metrics?.billing && !metrics?.non_aino_model_calls) {
    return null
  }

  const line = (
    <span className="flex min-w-0 flex-wrap gap-x-1.5">
      {!items.length && details.length > 0 && <span>{copy.details}</span>}
      {items.map((item, index) => (
        <span className="whitespace-nowrap" key={item}>
          {index > 0 ? '\u00b7 ' : ''}
          {item}
        </span>
      ))}
    </span>
  )

  const className = 'w-full min-w-0 text-[0.75rem] leading-5 text-muted-foreground tabular-nums'

  const nonAinoModelCalls = metrics?.non_aino_model_calls ? <div>{copy.nonAinoModelCalls}</div> : null

  if (!details.length) {
    return (
      <div className={className} data-slot="aui_reply-metrics">
        {line}
        {metrics?.billing && <ReplyCost billing={metrics.billing} />}
        {nonAinoModelCalls}
      </div>
    )
  }

  return (
    <div className={className} data-slot="aui_reply-metrics">
      <details className="group/reply-metrics">
        <summary
          aria-label={copy.details}
          className="flex cursor-pointer list-none items-start gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        >
          {line}
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 transition-transform group-open/reply-metrics:rotate-180" />
        </summary>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
          {details.map(detail => (
            <span className="min-w-0 [overflow-wrap:anywhere]" key={detail}>
              {detail}
            </span>
          ))}
        </div>
      </details>
      {metrics?.billing && <ReplyCost billing={metrics.billing} />}
      {nonAinoModelCalls}
    </div>
  )
}
