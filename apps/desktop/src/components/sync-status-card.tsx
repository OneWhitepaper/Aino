/**
 * SyncStatusCard — the desktop warning surface for the latest pm/plugin sync
 * receipt (SPEC-05). The renderer calls `getSyncStatus` here and paints the
 * derived summary: failed venv rebuilds, dependency-bisect disables,
 * needs-fixing update_url mismatches, and available plugin updates. The
 * surface degrades to nothing when there is no receipt (older backends, no
 * sync yet) rather than rendering an empty box.
 *
 * The copy lives in `deriveSyncStatusSummary` (the extracted, unit-tested
 * owner) — this component is presentation only, so the wording cannot drift
 * between the derivation and the paint.
 */

import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle, AlertTriangle, Check } from '@/lib/icons'

import { deriveSyncStatusSummary, type SyncStatusSummary } from './sync-status'

export function SyncStatusCard() {
  const [summary, setSummary] = useState<SyncStatusSummary | null>(null)

  useEffect(() => {
    let alive = true

    void window.hermesDesktop
      ?.getSyncStatus?.()
      .then(receipt => {
        if (alive) {
          setSummary(deriveSyncStatusSummary(receipt))
        }
      })
      .catch(() => {
        // A missing/broken receipt surface must never break the updates
        // overlay — degrade to nothing (the receipt is advisory).
        if (alive) {
          setSummary(null)
        }
      })

    return () => {
      alive = false
    }
  }, [])

  if (!summary?.headline) {
    return null
  }

  const variant = summary.level === 'error' ? 'destructive' : summary.level === 'warn' ? 'warning' : 'default'

  return (
    <Alert
      className="text-left"
      data-testid="sync-status-card"
      role={summary.level === 'error' || summary.level === 'warn' ? 'alert' : 'status'}
      variant={variant}
    >
      {summary.level === 'error' || summary.level === 'warn' ? <AlertCircle aria-hidden /> : <Check aria-hidden />}
      <AlertTitle>{summary.headline}</AlertTitle>
      <AlertDescription className="text-[0.8125rem] leading-5">
        {summary.needsFixing.length > 0 && (
          <ul className="grid min-w-0 gap-1">
            {summary.needsFixing.map(item => (
              <li className="flex items-start gap-2" key={`needs-fixing-${item.plugin}`}>
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-(--ui-yellow)" />
                <span className="min-w-0">
                  {item.plugin}: {item.reason}
                </span>
              </li>
            ))}
          </ul>
        )}

        {summary.disabledPlugins.length > 0 && (
          <ul className="grid min-w-0 gap-1">
            {summary.disabledPlugins.map(item => (
              <li className="flex items-start gap-2" key={`disabled-${item.plugin}`}>
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-(--ui-yellow)" />
                <span className="min-w-0">
                  {item.plugin}: {item.reason}
                </span>
              </li>
            ))}
          </ul>
        )}

        {summary.updatesAvailable.length > 0 && (
          <ul className="grid min-w-0 gap-1">
            {summary.updatesAvailable.map(item => (
              <li className="min-w-0" key={`update-${item.name}`}>
                {item.name}
                {item.current && item.latest ? `: ${item.current} → ${item.latest}` : ''}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}
