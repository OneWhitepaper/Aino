import { compactNumber } from '@hermes/shared'
import { useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ContextBreakdown, ContextUsageCategory, UsageStats } from '@/types/hermes'

function tokenCountLabel(value: number | null | undefined): string {
  return value == null ? '\u2014' : compactNumber(value)
}

interface ContextUsagePanelProps {
  compact?: boolean
  compacting?: boolean
  breakdown: ContextBreakdown | null
  loading: boolean
  showTitle?: boolean
  usage: UsageStats
}

/** Presentational: the breakdown is fetched by the composer (see
 *  `useContextBreakdown`) because the gauge's own label needs it, so the
 *  popover opens with its numbers already in hand. `usage` is the gauge's
 *  merged figure — measured occupancy when the backend has it, the estimate
 *  otherwise — so the header and the bar can never disagree. */
export function ContextUsagePanel({
  compact = false,
  compacting = false,
  breakdown,
  loading,
  showTitle = true,
  usage
}: ContextUsagePanelProps) {
  const { t } = useI18n()
  const copy = t.shell.statusbar.contextUsagePanel
  const contextMax = usage.context_max
  const contextUsed = usage.context_used

  const contextPercent =
    usage.context_percent == null ? null : Math.max(0, Math.min(100, Math.round(usage.context_percent)))

  const categories = useMemo(
    () =>
      (breakdown?.categories ?? []).map(category => ({
        ...category,
        label: copy.categories[category.id as keyof typeof copy.categories] ?? category.label
      })),
    [breakdown?.categories, copy]
  )

  const segmentTotal = categories.reduce((sum, category) => sum + category.tokens, 0) || contextUsed || 1
  const usedLabel = tokenCountLabel(contextUsed)
  const maxLabel = tokenCountLabel(contextMax)

  const hasContextData = (contextMax ?? 0) > 0 || (contextUsed ?? 0) > 0 || categories.length > 0

  const status = compacting
    ? copy.compacting
    : contextPercent !== null
      ? `${usage.context_estimated ? '~' : ''}${copy.percentFull(contextPercent)}`
      : hasContextData
        ? null
        : loading
          ? copy.loading
          : copy.empty

  if (compact) {
    return (
      <div
        className="flex flex-col items-center gap-1 px-4 py-3 text-[length:var(--aino-text-ui)] leading-5"
        data-slot="context-usage-hint"
      >
        <p className="font-medium text-muted-foreground">{copy.title}</p>
        {status && <p className="text-muted-foreground">{status}</p>}
        {hasContextData && (
          <p className="text-foreground">
            {copy.tokenSummary(`${usage.context_estimated && contextUsed != null ? '~' : ''}${usedLabel}`, maxLabel)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 p-3 text-[0.75rem]" data-slot="context-usage-panel">
      <div className="flex items-baseline justify-between gap-2">
        {showTitle && <p className="font-medium text-foreground">{copy.title}</p>}

        <span className="text-[0.6875rem] text-muted-foreground">
          {copy.tokenSummary(`${usage.context_estimated && contextUsed != null ? '~' : ''}${usedLabel}`, maxLabel)}
        </span>
      </div>

      {compacting && (
        <p className="text-muted-foreground" role="status">
          {copy.compacting}
        </p>
      )}

      {contextPercent !== null && (
        <p className="flex items-center justify-between gap-2 text-[0.6875rem] text-foreground">
          <span>
            {usage.context_estimated ? '~' : ''}
            {copy.percentFull(contextPercent)}
          </span>

          {usage.compressions !== undefined && (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground"
              data-testid="context-panel-compressions"
            >
              <Codicon aria-hidden="true" name="layers" size="0.6875rem" />
              {t.shell.statusbar.compressions(usage.compressions)}
            </span>
          )}
        </p>
      )}

      <ContextUsageBar categories={categories} segmentTotal={segmentTotal} />

      <ul className="flex flex-col gap-1.5">
        {categories.map(category => (
          <li className="flex items-center justify-between gap-2" key={category.id}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: category.color }} />

              <span className="truncate text-muted-foreground">{category.label}</span>
            </span>

            <span className="shrink-0 tabular-nums text-foreground">~{compactNumber(category.tokens)}</span>
          </li>
        ))}
      </ul>

      {loading && !categories.length && <p className="text-[0.6875rem] text-muted-foreground">{copy.loading}</p>}

      {!loading && !categories.length && !hasContextData && (
        <p className="text-[0.6875rem] text-muted-foreground">{copy.empty}</p>
      )}
    </div>
  )
}

/** The statusbar meter's trailing `[bar] N%`, plus a quiet `layers N` once the
 *  live session has compacted — the same glyph the sidebar puts on rows that
 *  came from a compression, so the two read as one idea. Zero stays out of the
 *  meter (every fresh session would carry noise); the panel shows it. */
export function ContextMeterDetail({ bar, compressions }: { bar: string; compressions?: number }) {
  if (!compressions) {
    return bar
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {bar}
      <span className="inline-flex items-center gap-0.5 tabular-nums" data-testid="context-meter-compressions">
        <Codicon aria-hidden="true" name="layers" size="0.6875rem" />
        {compressions}
      </span>
    </span>
  )
}

function ContextUsageBar({
  categories,
  segmentTotal
}: {
  categories: readonly ContextUsageCategory[]
  segmentTotal: number
}) {
  return (
    <div
      className={cn(
        'flex h-1.5 overflow-hidden rounded-full',
        categories.length ? 'bg-(--ui-stroke-tertiary)' : 'dither bg-(--ui-bg-elevated)'
      )}
      data-slot="context-usage-bar"
    >
      {categories.map(category => (
        <span
          className="h-full min-w-px"
          key={category.id}
          style={{
            background: category.color,
            width: `${(category.tokens / segmentTotal) * 100}%`
          }}
        />
      ))}
    </div>
  )
}
