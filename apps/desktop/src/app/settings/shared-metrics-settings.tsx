import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DocsLink } from '@/components/onboarding/flow'
import { useI18n } from '@/i18n'
import { $activeConnectionId } from '@/store/connections'
import { setDesktopMetricsGate } from '@/store/desktop-metrics'
import { requestGatewayForAgent } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $settingsScopeProfile } from '@/store/settings-scope'
import {
  readSharedMetricsConsent,
  saveSharedMetricsConsent,
  SHARED_METRICS_DOCS_URL,
  type SharedMetricsConsent,
  sharedMetricsProfileRequester
} from '@/store/shared-metrics'

import { ToggleRow } from './primitives'

/**
 * Settings › Safety › Privacy: one switch for the answer the first-run offer and
 * `hermes setup` write, for the profile this page applies to. On sets both
 * opt-ins (collect and send), off clears both. A collect-only answer from
 * before the offer dropped it reads off here: nothing is shared. Optimistic,
 * rolled back on failure.
 */
export function SharedMetricsSettings() {
  const { t } = useI18n()
  const copy = t.sharedMetrics
  const scopeProfile = useStore($settingsScopeProfile)
  const connectionId = useStore($activeConnectionId)
  const [consent, setConsent] = useState<SharedMetricsConsent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)

  const request = useMemo(
    () =>
      sharedMetricsProfileRequester(
        <T,>(method: string, params: Record<string, unknown> = {}) =>
          requestGatewayForAgent<T>(connectionId, scopeProfile, method, params, undefined, undefined, {
            spawnPriority: 'foreground'
          }),
        scopeProfile
      ),
    [connectionId, scopeProfile]
  )

  // eslint-disable-next-line no-restricted-syntax -- invalidates request generations; owner values are read from atoms directly
  useEffect(() => {
    const version = ++revision.current

    setLoaded(false)
    setConsent(null)
    setBusy(false)
    void readSharedMetricsConsent(request).then(next => {
      if (revision.current === version) {
        setConsent(next)
        setLoaded(true)
      }
    })

    return () => {
      revision.current += 1
    }
  }, [request])

  const save = async (flags: { enabled: boolean; send: boolean }) => {
    const previous = consent
    const version = revision.current

    const isCurrent = () =>
      revision.current === version &&
      $activeConnectionId.get() === connectionId &&
      $settingsScopeProfile.get() === scopeProfile

    setBusy(true)
    setConsent({ ...flags, send: flags.enabled && flags.send, decided: true, recipient: 'aino' })

    try {
      const saved = await saveSharedMetricsConsent(request, flags)

      if (!isCurrent()) {
        return
      }

      setConsent(saved)

      // This page applies to the focused profile (unscoped, or scoped to it by name): Desktop
      // telemetry follows its switch at once.
      const focused =
        scopeProfile === null || normalizeProfileKey(scopeProfile) === normalizeProfileKey($activeGatewayProfile.get())

      if (saved && focused) {
        setDesktopMetricsGate(saved.enabled ? 'on' : 'off')
      }
    } catch (err) {
      if (isCurrent()) {
        setConsent(previous)
        notifyError(err, copy.saveFailed)
      }
    } finally {
      if (isCurrent()) {
        setBusy(false)
      }
    }
  }

  // An older backend has no shared_metrics.* methods: keep the control, disabled and explained.
  const unavailable = loaded && consent === null
  const sharing = consent?.send ?? false

  return (
    <div className="grid gap-1" id="setting-shared-metrics">
      <ToggleRow
        below={<DocsLink href={SHARED_METRICS_DOCS_URL}>{copy.whatIsCollected}</DocsLink>}
        checked={sharing}
        description={copy.sendDesc}
        disabled={!consent || busy}
        hint={unavailable ? copy.unavailable : undefined}
        label={copy.sendLabel}
        onChange={on => void save({ enabled: on, send: on })}
      />
    </div>
  )
}
