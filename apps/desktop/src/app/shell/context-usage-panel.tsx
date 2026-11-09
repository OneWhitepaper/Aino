import { compactNumber } from '@hermes/shared'
import { useContext, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { type Translations, useI18n } from '@/i18n'
import { Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { ContextBreakdown, ContextUsageCategory, UsageStats } from '@/types/hermes'

import type { CompactConversationAction } from './hooks/use-compact-conversation'
import { StatusbarMenuCloseContext } from './statusbar-controls'

function tokenCountLabel(value: number | null | undefined): string {
  return value == null ? '\u2014' : compactNumber(value)
}

interface ContextUsagePanelProps {
  compacting?: boolean
  breakdown: ContextBreakdown | null
  /** Omitted by surfaces that cannot act on the session: numbers only. */
  compact?: boolean | CompactConversationAction
  loading: boolean
  unavailable?: boolean
  onRetry?: () => void
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
  unavailable = false,
  onRetry,
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

  const status = contextStatus(copy, compacting, contextPercent, usage.context_estimated, hasContextData, loading)

  const summary = copy.tokenSummary(
    `${usage.context_estimated && contextUsed != null ? '~' : ''}${usedLabel}`,
    maxLabel
  )

  if (compact === true) {
    return (
      <CompactContextUsage
        categories={categories}
        hasContextData={hasContextData}
        status={status}
        summary={summary}
        unavailable={unavailable}
      />
    )
  }

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-3 p-3 text-[length:var(--aino-text-caption)]"
      data-slot="context-usage-panel"
    >
      <div className="flex items-baseline justify-between gap-2">
        {showTitle && <p className="font-medium text-foreground">{copy.title}</p>}

        <span className="text-[length:var(--aino-text-caption)] text-muted-foreground">{summary}</span>
      </div>

      {compacting && (
        <p className="text-muted-foreground" role="status">
          {copy.compacting}
        </p>
      )}

      {contextPercent !== null && (
        <p className="flex items-center justify-between gap-2 text-[length:var(--aino-text-caption)] text-foreground">
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

      <ContextUsageBar categories={categories} contextPercent={contextPercent} segmentTotal={segmentTotal} />

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

      <ContextUsageEmptyState
        breakdown={breakdown}
        hasCategories={categories.length > 0}
        hasContextData={hasContextData}
        loading={loading}
        onRetry={onRetry}
        unavailable={unavailable}
      />
      {typeof compact === 'object' && <CompactConversationRow compact={compact} />}
    </div>
  )
}

function CompactConversationRow({ compact }: { compact: CompactConversationAction }) {
  const { t } = useI18n()
  const closeMenu = useContext(StatusbarMenuCloseContext)
  const copy = t.shell.statusbar.contextUsagePanel.compact

  return (
    <div className="flex flex-col gap-1.5 border-t border-(--ui-stroke-tertiary) pt-2" data-slot="context-compact">
      <p className="text-[length:var(--aino-text-caption)] text-muted-foreground">
        {compact.busy ? copy.busyHint : copy.hint}
      </p>

      {compact.pending ? (
        <p
          className="inline-flex items-center gap-1.5 text-[length:var(--aino-text-caption)] text-muted-foreground"
          data-testid="context-compact-pending"
        >
          <Loader2 className="size-3 animate-spin" />
          {copy.working}
        </p>
      ) : (
        // Close the dropdown first: left open under the shared confirmation, its
        // modal layer keeps trapping pointer events and the meter cannot reopen.
        <Button
          className="w-full justify-start"
          disabled={compact.busy || compact.unavailable}
          onClick={() => {
            closeMenu()
            compact.onRequest()
          }}
          size="xs"
          type="button"
          variant="ghost"
        >
          <Codicon name="archive" size="0.75rem" />
          {copy.action}
        </Button>
      )}
    </div>
  )
}

interface CompactContextUsageProps {
  categories: readonly ContextUsageCategory[]
  hasContextData: boolean
  status: string | null
  summary: string
  unavailable: boolean
}

function CompactContextUsage({ categories, hasContextData, status, summary, unavailable }: CompactContextUsageProps) {
  const { t } = useI18n()
  const copy = t.shell.statusbar.contextUsagePanel

  return (
    <div className="context-usage-compact" data-slot="context-usage-hint">
      <div className="context-usage-compact-header">
        <p className="context-usage-compact-title">{copy.compactTitle}</p>
        {status && <p className="context-usage-compact-status">{status}</p>}
      </div>
      {hasContextData && <p className="context-usage-compact-summary">{summary}</p>}
      {categories.slice(0, 4).length > 0 && (
        <ul className="context-usage-compact-categories" data-slot="context-usage-compact-categories">
          {categories.slice(0, 4).map(category => (
            <li key={category.id}>
              <span className="context-usage-compact-category-name">
                <span
                  aria-hidden="true"
                  className="context-usage-compact-category-dot"
                  style={{ background: category.color }}
                />
                <span>{category.label}</span>
              </span>
              <span className="context-usage-compact-category-tokens">~{compactNumber(category.tokens)}</span>
            </li>
          ))}
        </ul>
      )}
      {!hasContextData && unavailable && <p className="context-usage-compact-status">{copy.unavailable}</p>}
    </div>
  )
}

interface ContextUsageEmptyStateProps {
  breakdown: ContextBreakdown | null
  hasContextData: boolean
  hasCategories: boolean
  loading: boolean
  unavailable: boolean
  onRetry?: () => void
}

function ContextUsageEmptyState({
  breakdown,
  hasContextData,
  hasCategories,
  loading,
  unavailable,
  onRetry
}: ContextUsageEmptyStateProps) {
  const { t } = useI18n()
  const copy = t.shell.statusbar.contextUsagePanel

  if (hasCategories) {
    return null
  }

  if (loading) {
    return <p className="text-[length:var(--aino-text-caption)] text-muted-foreground">{copy.loading}</p>
  }

  if (unavailable) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-[length:var(--aino-text-caption)] text-muted-foreground" role="status">
          {hasContextData ? copy.detailsUnavailable : copy.unavailable}
        </p>
        {onRetry && (
          <Button onClick={onRetry} size="xs" type="button" variant="ghost">
            {copy.retry}
          </Button>
        )}
      </div>
    )
  }

  const message = hasContextData ? (breakdown ? copy.pendingDetails : null) : copy.empty

  return message ? <p className="text-[length:var(--aino-text-caption)] text-muted-foreground">{message}</p> : null
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
  contextPercent,
  segmentTotal
}: {
  categories: readonly ContextUsageCategory[]
  contextPercent: number | null
  segmentTotal: number
}) {
  return (
    <div
      className={cn(
        'flex h-1.5 overflow-hidden rounded-full',
        categories.length || contextPercent !== null ? 'bg-(--ui-stroke-tertiary)' : 'dither bg-(--ui-bg-elevated)'
      )}
      data-slot="context-usage-bar"
    >
      {!categories.length && contextPercent !== null && (
        <span className="h-full bg-(--ui-text-tertiary)" style={{ width: `${contextPercent}%` }} />
      )}
      {categories.map(category => (
        <span
          className="h-full min-w-px"
          key={category.id}
          style={{
            background: category.color,
            width: `${(category.tokens / segmentTotal) * (contextPercent ?? 100)}%`
          }}
        />
      ))}
    </div>
  )
}

function contextStatus(
  copy: Translations['shell']['statusbar']['contextUsagePanel'],
  compacting: boolean,
  contextPercent: number | null,
  estimated: boolean | undefined,
  hasContextData: boolean,
  loading: boolean
) {
  return compacting
    ? copy.compacting
    : contextPercent !== null
      ? `${estimated ? '~' : ''}${copy.percentFull(contextPercent)}`
      : hasContextData
        ? null
        : loading
          ? copy.loading
          : copy.empty
}
