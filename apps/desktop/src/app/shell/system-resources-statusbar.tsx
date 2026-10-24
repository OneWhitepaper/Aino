import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import { getLocalHardware } from '@/hermes'
import { useI18n } from '@/i18n'
import { Activity } from '@/lib/icons'
import { $localModelsEnabled } from '@/store/local-models-flag'
import { $statusbarHiddenIds } from '@/store/statusbar-prefs'
import type { LocalHardware } from '@/types/hermes'

const POLL_MS = 5_000

function gb(bytes: number | null | undefined): string {
  return bytes ? `${(bytes / (1 << 30)).toFixed(0)}G` : '—'
}

function gbLong(bytes: number | null | undefined): string {
  return bytes ? `${(bytes / (1 << 30)).toFixed(1)} GB` : '—'
}

function MeterRow({ label, percent, value }: { label: string; percent: number | null; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-foreground">{value}</span>
      </div>
      {percent !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.max(1, Math.min(100, percent))}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function useSystemResourcesStatusbarItem(): StatusbarItem {
  const { t } = useI18n()
  const copy = t.shell.statusbar.systemResources
  const hiddenIds = useStore($statusbarHiddenIds)
  const enabled = $localModelsEnabled.get()
  const shown = enabled && !hiddenIds.includes('system-resources')
  const [hardware, setHardware] = useState<LocalHardware | null>(null)

  useEffect(() => {
    if (!shown) {
      return
    }

    let cancelled = false
    let timer: number | null = null

    const poll = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return
      }

      try {
        const next = await getLocalHardware()

        if (!cancelled) {
          setHardware(next)
        }
      } catch {
        if (!cancelled) {
          setHardware(null)
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), POLL_MS)
      }
    }

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden && !cancelled) {
        if (timer !== null) {
          window.clearTimeout(timer)
          timer = null
        }

        void poll()
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    void poll()

    return () => {
      cancelled = true

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [shown])

  const hasGpu = Boolean(hardware?.gpu_name)

  const vramPercent =
    hardware?.vram_used_bytes != null && hardware.vram_total_bytes
      ? Math.round((hardware.vram_used_bytes / hardware.vram_total_bytes) * 100)
      : null

  const ramUsed = hardware ? hardware.ram_total_bytes - hardware.ram_available_bytes : null

  const ramPercent =
    hardware?.ram_total_bytes && ramUsed != null ? Math.round((ramUsed / hardware.ram_total_bytes) * 100) : null

  const label = hardware
    ? hasGpu
      ? `GPU ${hardware.gpu_util_percent ?? 0}%${
          hardware.vram_used_bytes != null ? ` · ${gb(hardware.vram_used_bytes)}/${gb(hardware.vram_total_bytes)}` : ''
        }`
      : `RAM ${gb(ramUsed)}/${gb(hardware.ram_total_bytes)}`
    : copy.loading

  return {
    detail: undefined,
    hidden: !enabled,
    icon: <Activity className="size-3" />,
    id: 'system-resources',
    label,
    menuAlign: 'end',
    menuClassName: 'w-64 p-0',
    menuContent: (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3 text-[0.75rem]" data-slot="system-resources-panel">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <p className="shrink-0 font-medium text-foreground">{copy.title}</p>
          {hardware?.gpu_name && (
            <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">{hardware.gpu_name}</span>
          )}
        </div>
        {hasGpu && (
          <MeterRow
            label={copy.gpuUtilization}
            percent={hardware?.gpu_util_percent ?? null}
            value={`${hardware?.gpu_util_percent ?? 0}%`}
          />
        )}
        {hasGpu && (
          <MeterRow
            label={copy.gpuMemory}
            percent={vramPercent}
            value={`${gbLong(hardware?.vram_used_bytes)} / ${gbLong(hardware?.vram_total_bytes)}`}
          />
        )}
        <MeterRow
          label={copy.ram}
          percent={ramPercent}
          value={`${gbLong(ramUsed)} / ${gbLong(hardware?.ram_total_bytes)}`}
        />
        {hardware?.uma && <p className="text-[0.6875rem] text-muted-foreground">{copy.unifiedNote}</p>}
      </div>
    ),
    toggleLabel: enabled ? copy.toggle : undefined,
    variant: 'menu'
  }
}
