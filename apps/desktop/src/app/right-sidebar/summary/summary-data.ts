import { compactPath } from '@/lib/statusbar'
import type { PreviewArtifact } from '@/store/preview-status'
import type { ContextBreakdown, LocalHardware, UsageStats } from '@/types/hermes'

export type SummaryEnvironmentState =
  { kind: 'empty' | 'no-session' } | { cwd: string; kind: 'ready'; projectName: string }

export function summaryEnvironmentState({
  cwd,
  cwdOwner,
  projectName,
  selectedSession
}: {
  cwd: string
  cwdOwner: null | string
  projectName: null | string
  selectedSession: null | string
}): SummaryEnvironmentState {
  if (!selectedSession) {
    return { kind: 'no-session' }
  }

  const trimmedCwd = cwd.trim()

  if (!trimmedCwd || cwdOwner !== selectedSession || !projectName) {
    return { kind: 'empty' }
  }

  return { cwd: trimmedCwd, kind: 'ready', projectName }
}

export function summaryContextUsage(
  usage: UsageStats,
  breakdown: ContextBreakdown | null,
  fallbackContextMax?: number
): UsageStats {
  if (!breakdown && !fallbackContextMax && usage.context_source !== 'unknown') {
    return usage
  }

  // A fresh breakdown resolves the model's current capacity; a retained usage
  // snapshot can still carry the previous model's window. Occupancy keeps its
  // measured provenance, while an all-zero initialization placeholder cannot
  // override useful estimates from the backend.
  const hasUsage =
    usage.context_source !== 'unknown' &&
    usage.context_used != null &&
    (usage.context_used > 0 || (usage.context_max ?? 0) > 0)

  const hasBreakdownUsage =
    breakdown &&
    breakdown.context_source !== 'unknown' &&
    (breakdown.context_used > 0 || breakdown.categories.length > 0 || breakdown.context_max > 0)

  const context = hasUsage ? usage : hasBreakdownUsage ? breakdown : null

  const contextMax =
    breakdown && breakdown.context_max > 0
      ? breakdown.context_max
      : fallbackContextMax || ((usage.context_max ?? 0) > 0 ? usage.context_max : undefined)

  const contextUsed = context?.context_used

  return {
    ...usage,
    context_estimated: context?.context_estimated,
    context_max: contextMax,
    context_percent:
      contextMax && contextUsed != null
        ? Math.max(0, Math.min(100, Math.round((100 * contextUsed) / contextMax)))
        : undefined,
    context_source: context?.context_source,
    context_used: contextUsed
  }
}

export function formatSummaryPath(path: string): string {
  return compactPath(path)
}

export function formatHardwareBytes(bytes: number | null | undefined): string {
  return bytes != null && Number.isFinite(bytes) ? `${(bytes / 2 ** 30).toFixed(1)} GB` : '\u2014'
}

export type HardwareMeters =
  { kind: 'unavailable' } | { kind: 'ready'; ramPercent: number | null; vramPercent: number | null }

export function hardwareMeters(hardware: LocalHardware | null): HardwareMeters {
  if (!hardware) {
    return { kind: 'unavailable' }
  }

  const ramPercent =
    hardware.ram_total_bytes > 0
      ? (100 * Math.max(0, hardware.ram_total_bytes - hardware.ram_available_bytes)) / hardware.ram_total_bytes
      : null

  const vramPercent =
    hardware.vram_used_bytes != null && hardware.vram_total_bytes > 0
      ? (100 * hardware.vram_used_bytes) / hardware.vram_total_bytes
      : null

  return { kind: 'ready', ramPercent, vramPercent }
}

export function sourceItems(items: readonly PreviewArtifact[]) {
  return items.map(item => ({
    cwd: item.cwd,
    id: item.id,
    label: item.label,
    target: item.target
  }))
}
