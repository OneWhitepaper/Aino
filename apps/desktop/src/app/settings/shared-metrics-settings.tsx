import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DocsLink } from '@/components/onboarding/flow'
import { useI18n } from '@/i18n'
import { $activeConnectionId } from '@/store/connections'
import { captureDesktopMetricsGate } from '@/store/desktop-metrics'
import { requestGatewayForAgent } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
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
  const profile = useStore($settingsScopeProfile)
  const connectionId = useStore($activeConnectionId)

  const { t } = useI18n()
  const copy = t.sharedMetrics
  const [consent, setConsent] = useState<SharedMetricsConsent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)

  const request = useMemo(
    () =>
      sharedMetricsProfileRequester(
        <T,>(method: string, params: Record<string, unknown> = {}) =>
          requestGatewayForAgent<T>(connectionId, profile, method, params, undefined, undefined, {
            spawnPriority: 'foreground'
          }),
        profile
      ),
    [connectionId, profile]
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
      $settingsScopeProfile.get() === profile

    setBusy(true)
    setConsent({ ...flags, send: flags.enabled && flags.send, decided: true, recipient: 'aino' })

    try {
      const applyGate = await captureDesktopMetricsGate(`${connectionId ?? ''}|${profile}`)
      const saved = await saveSharedMetricsConsent(request, flags)

      if (!isCurrent()) {
        // A withdrawal still revokes its captured cohort, but an old owner's
        // delayed opt-in must never start collection in the current context.
        if (!saved.enabled) {
          await applyGate('off')
        }

        return
      }

      const applied = await applyGate(saved.enabled ? 'on' : 'off')
      setConsent(saved)

      if (!applied) {
        const applyCurrent = await captureDesktopMetricsGate(`${connectionId ?? ''}|${profile}`)
        const current = await readSharedMetricsConsent(request)

        if (isCurrent() && current?.decided && (await applyCurrent(current.enabled ? 'on' : 'off', current.decided))) {
          setConsent(current)
        }
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
