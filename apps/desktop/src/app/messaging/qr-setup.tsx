import { useCallback, useEffect, useRef, useState } from 'react'

import { resolveOwnerNow } from '@/api/client'
import {
  applyMessagingOnboarding,
  cancelMessagingOnboarding,
  getMessagingOnboarding,
  type MessagingOnboardingApplied,
  startMessagingOnboarding
} from '@/api/messaging-onboarding'
import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-state'
import { Loader } from '@/components/ui/loader'
import { type Translations, useI18n } from '@/i18n'
import { localizedMessagingPlatformName } from '@/i18n/messaging-platforms'
import { Check, RefreshCw } from '@/lib/icons'
import type { MessagingPlatformInfo } from '@/types/hermes'

type Phase = 'idle' | 'configured' | 'starting' | 'waiting' | 'scanned' | 'saving' | 'saved' | 'expired' | 'failed'
const CANCELLABLE_PHASES = new Set<Phase>(['starting', 'waiting', 'scanned'])

interface MessagingQrSetupProps {
  platform: MessagingPlatformInfo
  scopeProfile: string | undefined
  onApplied: (result: MessagingOnboardingApplied) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  onCancelChange?: (cancel: (() => Promise<void> | void) | null) => void
  onConnect?: () => void
  connecting?: boolean
  connectMessage?: string
}

export function MessagingQrSetup({
  platform,
  scopeProfile,
  onApplied,
  onBusyChange,
  onCancelChange,
  onConnect,
  connecting,
  connectMessage
}: MessagingQrSetupProps) {
  const { locale, t } = useI18n()
  const q = t.messaging.qrSetup
  const name = platform.id === 'qqbot' ? 'QQ' : localizedMessagingPlatformName(locale, platform.id, platform.name)
  const [owner] = useState(() => resolveOwnerNow({ profile: scopeProfile }))
  const [attempt, setAttempt] = useState(platform.configured ? 0 : 1)
  const [phase, setPhase] = useState<Phase>(platform.configured ? 'configured' : 'starting')
  const [qr, setQr] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied
  const cancelAttemptRef = useRef<(() => void) | null>(null)
  const submissionRef = useRef<Promise<void> | null>(null)
  const busy = phase === 'saving'

  useEffect(() => {
    onBusyChange?.(busy)

    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])

  // eslint-disable-next-line no-restricted-syntax -- exposes this attempt's teardown for synchronous cancellation, not a mirrored reactive value
  useEffect(() => {
    if (!attempt) {
      return
    }

    let cancelled = false
    let pairingId: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    let expiresAt = 0
    let pollDelay = 1800
    setPhase('starting')
    setQr('')
    setSaveFailed(false)

    const cancelPairing = () => {
      if (pairingId) {
        // Backend TTL is still authoritative when a disconnected viewer cannot cancel.
        void cancelMessagingOnboarding(platform.id, pairingId, owner).catch(() => undefined)
      }
    }

    const expire = () => {
      if (cancelled) {
        return
      }

      cancelled = true
      clearTimeout(timer)
      cancelPairing()
      setPhase('expired')
      setQr('')
    }

    const save = async (id: string) => {
      try {
        const result = await applyMessagingOnboarding(platform.id, id, owner)

        if (cancelled) {
          return
        }

        pairingId = null
        await onAppliedRef.current(result)

        if (!cancelled) {
          setPhase('saved')
        }
      } catch {
        if (!cancelled) {
          setSaveFailed(true)
          setPhase('failed')
        }
      }
    }

    const poll = async () => {
      if (!pairingId || cancelled) {
        return
      }

      if (Date.now() >= expiresAt) {
        expire()

        return
      }

      try {
        const status = await getMessagingOnboarding(platform.id, pairingId, owner)

        if (cancelled) {
          return
        }

        if (status.status === 'expired') {
          expire()

          return
        }

        if (status.status === 'error') {
          setPhase('failed')

          return
        }

        if (status.status === 'ready' || status.status === 'applied') {
          clearTimeout(expiryTimer)
          setPhase('saving')
          setQr('')

          const pending = save(pairingId)
          submissionRef.current = pending
          await pending

          if (submissionRef.current === pending) {
            submissionRef.current = null
          }

          return
        }

        setPhase(status.status === 'scanned' ? 'scanned' : 'waiting')
        pollDelay = Math.max(1000, Math.min(30_000, (status.poll_interval ?? pollDelay / 1000) * 1000))
        timer = setTimeout(() => void poll(), pollDelay)
      } catch {
        // A temporary transport failure can recover, but never beyond this QR's lifetime.
        if (!cancelled) {
          timer = setTimeout(() => void poll(), 2500)
        }
      }
    }
    void (async () => {
      try {
        const result = await startMessagingOnboarding(platform.id, owner)
        pairingId = result.pairing_id

        if (cancelled) {
          cancelPairing()

          return
        }

        expiresAt = Date.parse(result.expires_at)
        pollDelay = Math.max(1000, Math.min(30_000, (result.poll_interval ?? 1.8) * 1000))

        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          expire()

          return
        }

        const encoder = await import('qrcode')
        const data = await encoder.toDataURL(result.qr_payload, { errorCorrectionLevel: 'M', width: 240, margin: 2 })

        if (cancelled) {
          return
        }

        setQr(data)
        setPhase('waiting')
        expiryTimer = setTimeout(expire, expiresAt - Date.now())
        timer = setTimeout(() => void poll(), pollDelay)
      } catch {
        if (!cancelled) {
          setPhase('failed')
        }
      }
    })()

    const cancelAttempt = () => {
      if (cancelled) {
        return
      }

      cancelled = true
      clearTimeout(timer)
      clearTimeout(expiryTimer)
      cancelPairing()
    }

    cancelAttemptRef.current = cancelAttempt

    return cancelAttempt
  }, [attempt, platform.id, owner])

  const cancel = useCallback(async () => {
    cancelAttemptRef.current?.()
    setAttempt(0)
    setQr('')
    setSaveFailed(false)
    setPhase(platform.configured ? 'configured' : 'idle')
    await submissionRef.current
  }, [platform.configured])

  useEffect(() => {
    onCancelChange?.(cancel)

    return () => onCancelChange?.(null)
  }, [cancel, onCancelChange])

  const configured = phase === 'configured' || phase === 'saved'
  const connected = configured && platform.state === 'connected'
  const failed = phase === 'failed' || phase === 'expired'

  const label = connectionLabel(phase, platform, t.messaging, saveFailed, connectMessage)

  return (
    <section className="messaging-qr-setup">
      {!configured && phase !== 'idle' && <p className="messaging-qr-instruction">{q.scan(name)}</p>}
      {phase !== 'idle' && (
        <div className="messaging-qr-stage" data-phase={phase}>
          <QrVisual
            configured={configured}
            connected={connected && !connectMessage}
            failed={failed}
            label={label}
            name={name}
            qr={qr}
          />
        </div>
      )}
      {failed ? (
        <ErrorBanner>{label}</ErrorBanner>
      ) : (
        <p aria-live="polite" className="messaging-qr-status">
          {configured && <StatusDot tone={connected ? 'good' : 'warn'} />}
          {label}
        </p>
      )}
      <QrActions
        configured={configured}
        connected={connected}
        connecting={connecting}
        enabled={platform.enabled}
        onCancel={cancel}
        onConnect={onConnect}
        onRefresh={() => setAttempt(value => value + 1)}
        phase={phase}
      />
    </section>
  )
}

interface QrActionsProps {
  phase: Phase
  configured: boolean
  connected: boolean
  enabled: boolean
  connecting?: boolean
  onConnect?: () => void
  onCancel: () => void
  onRefresh: () => void
}

function QrActions({
  phase,
  configured,
  connected,
  enabled,
  connecting,
  onConnect,
  onCancel,
  onRefresh
}: QrActionsProps) {
  const { t } = useI18n()
  const q = t.messaging.qrSetup

  return (
    <div className="messaging-qr-actions">
      {configured && enabled && !connected && onConnect && (
        <Button disabled={connecting} onClick={onConnect} size="sm">
          {connecting ? t.messaging.states.connecting : q.reconnect}
        </Button>
      )}
      {CANCELLABLE_PHASES.has(phase) && (
        <Button onClick={onCancel} size="sm" variant="ghost">
          {t.common.cancel}
        </Button>
      )}
      {phase !== 'starting' && phase !== 'saving' && (
        <Button onClick={onRefresh} size="sm" variant="ghost">
          <RefreshCw />
          {configured ? q.replace : q.retry}
        </Button>
      )}
    </div>
  )
}

function connectionLabel(
  phase: Phase,
  platform: MessagingPlatformInfo,
  copy: Translations['messaging'],
  saveFailed: boolean,
  notice?: string
): string {
  const q = copy.qrSetup

  if (phase === 'idle') {
    return copy.states.not_configured
  }

  if (phase === 'configured' || phase === 'saved') {
    if (notice) {
      return notice
    }

    if (platform.state === 'connected') {
      return copy.states.connected
    }

    if (phase === 'saved' && !platform.configured) {
      return q.saved
    }

    return copy.states[platform.state ?? ''] || q.savedAccount
  }

  if (phase === 'failed') {
    return saveFailed ? q.saveFailed : q.failed
  }

  return q[phase]
}

function QrVisual({
  qr,
  failed,
  configured,
  connected,
  name,
  label
}: {
  qr: string
  failed: boolean
  configured: boolean
  connected: boolean
  name: string
  label: string
}) {
  const { t } = useI18n()

  if (failed) {
    return null
  }

  if (qr) {
    return <img alt={t.messaging.qrSetup.qrAlt(name)} height={240} src={qr} width={240} />
  }

  if (configured) {
    const Icon = connected ? Check : RefreshCw

    return <Icon aria-hidden="true" className="messaging-qr-connected" />
  }

  return <Loader label={label} />
}
