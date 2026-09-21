import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Loader } from '@/components/ui/loader'
import { getLocalHardware } from '@/hermes'
import { useViewedInterval } from '@/hooks/use-viewed-interval'
import { useI18n } from '@/i18n'
import { Activity, RefreshCw } from '@/lib/icons'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'

import { formatHardwareBytes } from '../right-sidebar/summary/summary-data'

import { ContributedStatusSettings } from './contributed-status-settings'
import { SectionHeading, SettingsContent } from './primitives'

function MeterRow({ label, percent, value }: { label: string; percent: number | null; value: string }) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{value}</span>
      </div>
      {percent !== null && (
        <div
          aria-label={label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(percent)}
          className="h-1.5 overflow-hidden rounded-full bg-(--ui-bg-tertiary)"
          role="meter"
        >
          <div className="h-full bg-(--aino-action-bg)" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
      )}
    </div>
  )
}

export function SystemResourcesSettings() {
  const { t } = useI18n()
  const copy = t.shell.statusbar.systemResources
  const connection = useStore($activeConnectionId)
  const profile = useStore($activeGatewayProfile)

  const {
    data: hardware,
    error,
    isPending,
    isFetching,
    refetch
  } = useQuery({
    queryKey: ['system-resources', connection, profile],
    queryFn: getLocalHardware,
    retry: false,
    refetchOnWindowFocus: false
  })

  useViewedInterval(
    () => {
      if (!isFetching) {
        void refetch()
      }
    },
    5000,
    !error
  )

  const ramUsed =
    hardware && hardware.ram_total_bytes > 0
      ? Math.max(0, hardware.ram_total_bytes - hardware.ram_available_bytes)
      : null

  const ramPercent = ramUsed !== null && hardware?.ram_total_bytes ? (100 * ramUsed) / hardware.ram_total_bytes : null

  const vramPercent =
    hardware?.vram_used_bytes != null && hardware.vram_total_bytes
      ? (100 * hardware.vram_used_bytes) / hardware.vram_total_bytes
      : null

  return (
    <SettingsContent>
      <SectionHeading icon={Activity} title={copy.title} />
      <p className="mb-6 text-xs text-muted-foreground">{copy.backendHost}</p>
      {isPending ? (
        <Loader />
      ) : error ? (
        <ErrorState title={copy.unavailable}>
          <Button className="justify-self-center" onClick={() => void refetch()} size="sm" variant="secondary">
            <RefreshCw />
            {t.common.retry}
          </Button>
        </ErrorState>
      ) : hardware ? (
        <div className="grid max-w-xl min-w-0 gap-6 text-[0.8125rem]" data-slot="system-resources-panel">
          <MeterRow
            label={hardware.uma ? t.settings.localModels.unifiedMemory : copy.ram}
            percent={ramPercent}
            value={`${formatHardwareBytes(ramUsed)} / ${formatHardwareBytes(hardware.ram_total_bytes || null)}`}
          />
          {hardware.gpu_name && <p className="break-words text-foreground">{hardware.gpu_name}</p>}
          {(hardware.gpu_name || hardware.vram_total_bytes > 0) && (
            <>
              {(!hardware.uma || hardware.gpu_util_percent != null) && (
                <MeterRow
                  label={copy.gpuUtilization}
                  percent={hardware.gpu_util_percent ?? null}
                  value={hardware.gpu_util_percent == null ? '\u2014' : `${hardware.gpu_util_percent}%`}
                />
              )}
              {(!hardware.uma || hardware.vram_used_bytes != null) && (
                <MeterRow
                  label={copy.gpuMemory}
                  percent={vramPercent}
                  value={`${formatHardwareBytes(hardware.vram_used_bytes)} / ${formatHardwareBytes(hardware.vram_total_bytes)}`}
                />
              )}
            </>
          )}
          {hardware.uma && <p className="text-xs text-muted-foreground">{copy.unifiedNote}</p>}
        </div>
      ) : null}
      <ContributedStatusSettings />
    </SettingsContent>
  )
}
