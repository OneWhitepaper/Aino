import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { summaryContextUsage } from '@/app/right-sidebar/summary/summary-data'
import { ContextUsagePanel } from '@/app/shell/context-usage-panel'
import { useContextBreakdown } from '@/app/shell/hooks/use-context-breakdown'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Tip } from '@/components/ui/tooltip'
import { type Translations, useI18n } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { sessionCompacting } from '@/store/compaction'
import { platformModelCatalog } from '@/store/platform-models'
import { $sessionStates } from '@/store/session-states'
import type { UsageStats } from '@/types/hermes'

import { useSessionView } from '../session-view'

interface ComposerContextUsageProps {
  enabled: boolean
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

const EMPTY_USAGE: UsageStats = { calls: 0, input: 0, output: 0, total: 0 }

/** Reuses the existing owner-bound context panel inside the Bot's add menu. */
export const ComposerContextUsagePresentation = createContext<'pill' | 'submenu'>('pill')

/** The model row's own session, using its existing owner-routed gateway request. */
export function ComposerContextUsage({ enabled, requestGateway }: ComposerContextUsageProps) {
  const presentation = useContext(ComposerContextUsagePresentation)
  const view = useSessionView()
  const sessionId = useStore(view.$runtimeId)
  const busy = useStore(view.$busy)
  const model = useStore(view.$model)
  const provider = useStore(view.$provider)
  const visible = usePaneVisible()
  const compacting = useStore(useMemo(() => sessionCompacting(sessionId), [sessionId]))
  const usage = useStoreSelector($sessionStates, states => (sessionId ? states[sessionId]?.usage : null) ?? EMPTY_USAGE)

  const platformModel = useStoreSelector($sessionStates, states =>
    sessionId ? states[sessionId]?.platformModel : null
  )

  const catalog = platformModelCatalog()
  const catalogState = useStore(catalog.state)
  const catalogOwner = useStore(catalog.owner.state).owner

  // Cold managed sessions are intentionally not bound until they send. The
  // existing account catalog can explain their capacity without minting a lease.
  const catalogContextMax =
    provider === 'aino' &&
    Boolean(catalogOwner?.user_id && catalogOwner.platform_origin) &&
    (!platformModel ||
      (platformModel.modelId === model &&
        platformModel.ownerUserId === catalogOwner?.user_id &&
        platformModel.platformOrigin === catalogOwner?.platform_origin))
      ? (catalogState.models.find(row => row.id === model)?.context_window ?? undefined)
      : undefined

  const fallbackContextMax =
    catalogContextMax &&
    catalogContextMax > 0 &&
    (platformModel?.status === 'awaiting_managed_credentials' ||
      !platformModel ||
      !(usage.context_max && usage.context_max > 0))
      ? catalogContextMax
      : undefined

  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const copy = t.shell.statusbar.contextUsagePanel

  useEffect(() => {
    if (enabled && visible && provider === 'aino' && catalogState.phase === 'idle') {
      void catalog.load()
    }
  }, [catalog, catalogState.phase, enabled, provider, visible])

  const { breakdown, loading, refetch, unavailable } = useContextBreakdown({
    busy,
    enabled: enabled && visible,
    identityKey: JSON.stringify([provider, model]),
    refreshKey: JSON.stringify([
      provider,
      model,
      usage.context_max,
      usage.context_percent,
      usage.context_used,
      fallbackContextMax
    ]),
    requestGateway,
    sessionId,
    suspended: compacting
  })

  const resolvedUsage = summaryContextUsage(usage, breakdown, fallbackContextMax)

  const percent =
    resolvedUsage.context_percent == null ? null : Math.max(0, Math.min(100, Math.round(resolvedUsage.context_percent)))

  useEffect(() => setOpen(false), [sessionId, visible])

  if (!sessionId) {
    return null
  }

  const status = contextUsageStatus(copy, compacting, percent, resolvedUsage, loading)

  const label = `${copy.title} · ${status}`
  const panelProps = { breakdown, compacting, loading, unavailable, onRetry: refetch, usage: resolvedUsage }

  const retryUnavailable = () => {
    if (!breakdown && !loading && enabled && visible && !busy && !compacting) {
      refetch()
    }
  }

  if (presentation === 'submenu') {
    return (
      <DropdownMenuSub onOpenChange={nextOpen => nextOpen && retryUnavailable()}>
        <DropdownMenuSubTrigger aria-label={label}>
          <Codicon name="pie-chart" size="0.875rem" />
          <span>{copy.title}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain">
          <ContextUsagePanel {...panelProps} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  return (
    <Popover
      onOpenChange={nextOpen => {
        setOpen(nextOpen)

        if (nextOpen) {
          retryUnavailable()
        }
      }}
      open={open}
    >
      <Tip
        className="context-usage-tooltip"
        label={<ContextUsagePanel {...panelProps} compact />}
        side="top"
        variant="card"
      >
        <PopoverTrigger asChild>
          <Button aria-label={label} data-slot="composer-context-usage" size="icon-xs" type="button" variant="ghost">
            <Progress
              animated={compacting}
              aria-label={copy.title}
              destructive={percent !== null && percent >= 95}
              indeterminate={compacting || percent === null}
              shape="ring"
              value={(percent ?? 0) / 100}
            />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        align="end"
        aria-label={copy.title}
        className="max-h-[min(28rem,var(--radix-popover-content-available-height))] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain"
        data-slot="composer-context-details"
        showArrow={false}
        side="top"
        sideOffset={8}
        variant="card"
      >
        <ContextUsagePanel {...panelProps} />
      </PopoverContent>
    </Popover>
  )
}

function contextUsageStatus(
  copy: Translations['shell']['statusbar']['contextUsagePanel'],
  compacting: boolean,
  percent: number | null,
  usage: UsageStats,
  loading: boolean
) {
  return compacting
    ? copy.compacting
    : percent !== null
      ? `${usage.context_estimated ? '~' : ''}${copy.percentFull(percent)}`
      : usage.context_used != null || usage.context_max != null
        ? copy.tokenSummary(
            usage.context_used == null
              ? '\u2014'
              : `${usage.context_estimated ? '~' : ''}${compactNumber(usage.context_used)}`,
            usage.context_max == null ? '\u2014' : compactNumber(usage.context_max)
          )
        : loading
          ? copy.loading
          : copy.empty
}
