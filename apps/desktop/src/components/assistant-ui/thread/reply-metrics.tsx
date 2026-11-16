import { compactNumber } from '@hermes/shared'
import { useContext } from 'react'

import { formatElapsed } from '@/components/chat/activity-timer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
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

  const content = (
    <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-2 text-[length:var(--aino-text-caption)] leading-5 text-muted-foreground tabular-nums">
      {elapsed && <span className="whitespace-nowrap">{elapsed}</span>}
      {details.map(detail => (
        <span className="min-w-0 [overflow-wrap:anywhere]" key={detail}>
          {detail}
        </span>
      ))}
      {metrics?.non_aino_model_calls && <span className="basis-full">{copy.nonAinoModelCalls}</span>}
    </div>
  )

  if (metrics?.billing) {
    return (
      <ReplyCost billing={metrics.billing} entryLabel={copy.usageAndCost}>
        {content}
      </ReplyCost>
    )
  }

  return (
    <div data-slot="aui_reply-metrics">
      <Dialog>
        <DialogTrigger asChild>
          <Button className="text-[length:var(--aino-text-caption)] font-normal" size="inline" variant="link">
            {copy.usageAndCost}
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{copy.usageAndCost}</DialogTitle>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    </div>
  )
}
