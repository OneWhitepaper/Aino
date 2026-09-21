import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'

import { getLocalHardware } from '@/hermes'
import { useViewedInterval } from '@/hooks/use-viewed-interval'
import { useI18n } from '@/i18n'
import { Cpu } from '@/lib/icons'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'
import { type LocalHardware } from '@/types/hermes'

import { formatHardwareBytes, hardwareMeters } from './summary-data'
import { SummarySection } from './summary-section'

function Meter({ label, percent, value }: { label: string; percent: number | null; value: string }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-(--ui-text-tertiary)">{label}</span>
        <span className="shrink-0 tabular-nums text-foreground">{value}</span>
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

function hardwareLabel(hardware: LocalHardware): string {
  return hardware.gpu_name || hardware.vram_label || ''
}

export function ResourcesSection() {
  const { t } = useI18n()
  const connection = useStore($activeConnectionId)
  const profile = useStore($activeGatewayProfile)

  const {
    data: hardware,
    error,
    isFetching,
    isPending,
    refetch
  } = useQuery({
    queryKey: ['system-resources', connection, profile],
    queryFn: getLocalHardware,
    refetchOnWindowFocus: false,
    retry: false
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

  const copy = t.summary.resources
  const meters = hardwareMeters(hardware ?? null)

  if (isPending) {
    return <SummarySection icon={Cpu} state="loading" title={copy.title} />
  }

  if (error || meters.kind === 'unavailable') {
    return (
      <SummarySection
        error={copy.unavailable}
        icon={Cpu}
        onRetry={() => void refetch()}
        state="error"
        title={copy.title}
      />
    )
  }

  const ramUsed =
    hardware.ram_total_bytes > 0 ? Math.max(0, hardware.ram_total_bytes - hardware.ram_available_bytes) : null

  return (
    <SummarySection icon={Cpu} title={copy.title}>
      <div className="grid gap-2.5">
        <Meter
          label={hardware.uma ? t.settings.localModels.unifiedMemory : copy.ram}
          percent={meters.ramPercent}
          value={`${formatHardwareBytes(ramUsed)} / ${formatHardwareBytes(hardware.ram_total_bytes)}`}
        />
        {hardwareLabel(hardware) && (
          <p className="truncate text-(--ui-text-secondary)" title={hardwareLabel(hardware)}>
            {hardwareLabel(hardware)}
          </p>
        )}
        {(hardware.gpu_name || hardware.vram_total_bytes > 0) &&
          (!hardware.uma || hardware.vram_used_bytes != null) && (
            <Meter
              label={copy.gpu}
              percent={meters.vramPercent}
              value={`${formatHardwareBytes(hardware.vram_used_bytes)} / ${formatHardwareBytes(hardware.vram_total_bytes)}`}
            />
          )}
      </div>
    </SummarySection>
  )
}
