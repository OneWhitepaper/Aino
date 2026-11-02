import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import type { IconComponent } from '@/lib/icons'
import { cn } from '@/lib/utils'

export interface SummarySectionProps {
  action?: ReactNode
  children?: ReactNode
  embedded?: boolean
  emptyMessage?: ReactNode
  error?: string
  icon?: IconComponent
  onRetry?: () => void
  state?: 'empty' | 'error' | 'loading' | 'ready'
  title: string
}

/** Flat, independently stateful groups within the summary card. */
export function SummarySection({
  action,
  children,
  embedded = false,
  emptyMessage,
  error,
  icon: Icon,
  onRetry,
  state = 'ready',
  title
}: SummarySectionProps) {
  const { t } = useI18n()
  const copy = t.summary

  return (
    <section
      className={
        embedded ? 'py-1' : 'border-t border-(--ui-stroke-tertiary) py-3 first:border-t-0 first:pt-0 last:pb-0'
      }
      data-slot="summary-section"
      data-state={state}
    >
      <div className={embedded ? 'sr-only' : 'mb-2 flex min-w-0 items-center gap-2'} data-slot="summary-section-header">
        {Icon && <Icon className="size-4 shrink-0 text-(--ui-text-tertiary)" />}
        <h2 className="min-w-0 flex-1 truncate text-[length:var(--aino-text-caption)] font-medium text-(--ui-text-tertiary)">
          {title}
        </h2>
        {action}
      </div>

      {state === 'loading' ? (
        <Loader className="py-2" label={copy.state.loading} />
      ) : state === 'error' ? (
        <div className="flex min-w-0 items-center gap-2 text-[length:var(--aino-text-ui)] leading-5 text-(--ui-text-tertiary)">
          <Codicon className="shrink-0 text-destructive" name="error" size="0.8rem" />
          <span className="min-w-0 flex-1 break-words">{error ?? copy.state.unavailable}</span>
          {onRetry && (
            <Button aria-label={copy.state.retry} onClick={onRetry} size="inline" type="button" variant="text">
              {copy.state.retry}
            </Button>
          )}
        </div>
      ) : state === 'empty' ? (
        <div className="flex min-w-0 items-center gap-2 text-[length:var(--aino-text-ui)] leading-5 text-(--ui-text-tertiary)">
          <p className="min-w-0 flex-1">{emptyMessage ?? copy.state.noData}</p>
          {onRetry && (
            <Button aria-label={copy.state.retry} onClick={onRetry} size="inline" type="button" variant="text">
              {copy.state.retry}
            </Button>
          )}
        </div>
      ) : children === null ? null : (
        <div
          className={cn(
            'min-w-0 text-[length:var(--aino-text-ui)] leading-5 text-(--ui-text-secondary)',
            !children && 'text-(--ui-text-tertiary)'
          )}
        >
          {children ?? copy.state.noData}
        </div>
      )}
    </section>
  )
}

export function SummaryValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-(--ui-text-tertiary)">{label}</span>
      <span
        className="min-w-0 truncate text-right text-foreground"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  )
}
