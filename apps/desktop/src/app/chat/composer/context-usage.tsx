import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { summaryContextUsage } from '@/app/right-sidebar/summary/summary-data'
import { ContextUsagePanel } from '@/app/shell/context-usage-panel'
import { useContextBreakdown } from '@/app/shell/hooks/use-context-breakdown'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
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

/** The model row's own session, using its existing owner-routed gateway request. */
export function ComposerContextUsage({ enabled, requestGateway }: ComposerContextUsageProps) {
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

  const { breakdown, loading, refetch } = useContextBreakdown({
    busy: busy || compacting,
    enabled: enabled && visible,
    refreshKey: JSON.stringify([provider, model, usage.context_max, fallbackContextMax]),
    requestGateway,
    sessionId
  })

  const resolvedUsage = summaryContextUsage(usage, breakdown, fallbackContextMax)

  const percent =
    resolvedUsage.context_percent == null ? null : Math.max(0, Math.min(100, Math.round(resolvedUsage.context_percent)))

  useEffect(() => setOpen(false), [sessionId, visible])

  if (!sessionId) {
    return null
  }

  const status = compacting
    ? copy.compacting
    : percent !== null
      ? `${resolvedUsage.context_estimated ? '~' : ''}${copy.percentFull(percent)}`
      : resolvedUsage.context_used != null || resolvedUsage.context_max != null
        ? copy.tokenSummary(
            resolvedUsage.context_used == null
              ? '\u2014'
              : `${resolvedUsage.context_estimated ? '~' : ''}${compactNumber(resolvedUsage.context_used)}`,
            resolvedUsage.context_max == null ? '\u2014' : compactNumber(resolvedUsage.context_max)
          )
        : loading
          ? copy.loading
          : copy.empty

  const label = `${copy.title} · ${status}`
  const panelProps = { breakdown, compacting, loading, usage: resolvedUsage }

  const retryUnavailable = () => {
    if (!breakdown && !loading && enabled && visible && !busy && !compacting) {
      refetch()
    }
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
      <Tip label={<ContextUsagePanel {...panelProps} compact />} side="top" variant="card">
        <PopoverTrigger asChild>
          <Button aria-label={label} data-slot="composer-context-usage" size="icon-xs" type="button" variant="ghost">
            <Progress
              animated={compacting || loading}
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
