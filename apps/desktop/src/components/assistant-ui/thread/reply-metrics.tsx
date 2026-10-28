import { compactNumber } from '@hermes/shared'
import { useContext } from 'react'

import { formatElapsed } from '@/components/chat/activity-timer'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { useI18n } from '@/i18n'
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

  const elapsed =
    duration !== undefined && !durationInProcessHeader
      ? `${copy.duration} ${formatElapsed(Math.round(duration))}`
      : null

  const details = [
    metrics?.total_tokens !== undefined ? `${copy.tokens} ${compactNumber(metrics.total_tokens)} token` : null,
    metrics?.context_percent !== undefined
      ? `${copy.context} ${metrics.context_estimated ? '~' : ''}${Math.round(metrics.context_percent)}%`
      : null,
    metrics?.tokens_per_second !== undefined ? `${Math.round(metrics.tokens_per_second)} token/s` : null,
    metrics?.cache_hit_pct !== undefined ? `${copy.cache} ${Math.round(metrics.cache_hit_pct)}%` : null,
    metrics?.session_elapsed_s !== undefined
      ? `${copy.sessionElapsed} ${formatElapsed(Math.round(metrics.session_elapsed_s))}`
      : null,
    metrics?.input_tokens !== undefined ? `${copy.input} ${compactNumber(metrics.input_tokens)} token` : null,
    metrics?.output_tokens !== undefined ? `${copy.output} ${compactNumber(metrics.output_tokens)} token` : null,
    metrics?.context_used !== undefined && metrics.context_max !== undefined
      ? `${copy.context} ${compactNumber(metrics.context_used)} / ${compactNumber(metrics.context_max)}`
      : null
  ].filter((item): item is string => item !== null)

  if (!elapsed && !details.length && !metrics?.billing && !metrics?.non_aino_model_calls) {
    return null
  }

  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--aino-text-caption)] leading-5 text-muted-foreground tabular-nums"
      data-slot="aui_reply-metrics"
    >
      {elapsed && <span className="whitespace-nowrap">{elapsed}</span>}
      {details.length > 0 && (
        <details className="group/reply-metrics min-w-0 max-w-full open:basis-full">
          <summary
            aria-label={copy.details}
            className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
            data-slot="disclosure-toggle"
          >
            <span>{copy.details}</span>
            <span className="flex h-5 shrink-0 items-center" data-slot="disclosure-caret">
              <DisclosureCaret className="group-open/reply-metrics:rotate-90" open={false} />
            </span>
          </summary>
          <div className="my-1.5 flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-(--ui-bg-quinary) px-3 py-2">
            {details.map(detail => (
              <span className="min-w-0 [overflow-wrap:anywhere]" key={detail}>
                {detail}
              </span>
            ))}
          </div>
        </details>
      )}
      {metrics?.billing && <ReplyCost billing={metrics.billing} />}
      {metrics?.non_aino_model_calls && <span className="basis-full">{copy.nonAinoModelCalls}</span>}
    </div>
  )
}
