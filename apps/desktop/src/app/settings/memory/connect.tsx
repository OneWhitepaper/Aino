import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { getMemoryProviderOAuthStatus, startMemoryProviderOAuth } from '@/hermes'
import { useI18n } from '@/i18n'
import { Check, ExternalLink, Loader2 } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import type { MemoryProviderOAuthStatus } from '@/types/hermes'

const POLL_MS = 1500
const POLL_TIMEOUT_MS = 120_000

// Small connect affordance rendered under the provider dropdown. Capability is
// backend-driven: the status route 404s for providers without an oauth_flow
// module, so non-OAuth providers render nothing.
export function MemoryConnect({ profile, provider }: { profile?: string; provider: string }) {
  const { t } = useI18n()
  const m = t.settings.memory
  const [capable, setCapable] = useState<'no' | 'unknown' | 'yes'>('unknown')
  const [connected, setConnected] = useState(false)
  const [auth, setAuth] = useState<MemoryProviderOAuthStatus['auth']>(null)
  const [phase, setPhase] = useState<'error' | 'idle' | 'pending'>('idle')
  const [detail, setDetail] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generation = useRef(0)

  const stop = useCallback(() => {
    generation.current += 1

    if (timer.current !== null) {
      clearInterval(timer.current)
      timer.current = null
    }

    if (timeout.current !== null) {
      clearTimeout(timeout.current)
      timeout.current = null
    }
  }, [])

  useEffect(() => {
    let active = true
    setCapable('unknown')
    setPhase('idle')
    setDetail('')
    getMemoryProviderOAuthStatus(provider, profile)
      .then(s => {
        if (!active) {
          return
        }

        setCapable('yes')
        setConnected(s.connected)
        setAuth(s.auth)
      })
      .catch(() => {
        if (active) {
          setCapable('no')
        }
      })

    return () => {
      active = false
      stop()
    }
  }, [profile, provider, stop])

  // An error message isn't sticky — it clears back to the steady state
  // (Connect link, plus the connected badge if a credential is stored).
  useEffect(() => {
    if (phase !== 'error') {
      return
    }

    const t = setTimeout(() => {
      setPhase('idle')
      setDetail('')
    }, 6000)

    return () => clearTimeout(t)
  }, [phase])

  const connect = useCallback(async () => {
    stop()
    const attempt = generation.current
    setPhase('pending')

    try {
      await startMemoryProviderOAuth(provider, profile)
    } catch (err) {
      if (generation.current !== attempt) {
        return
      }

      setPhase('error')
      setDetail(m.startConnectionFailed)
      notifyError(err, m.failedStartConnection)

      return
    }

    if (generation.current !== attempt) {
      return
    }

    // A rejected or stalled status request must not outlive the consent deadline.
    timeout.current = setTimeout(() => {
      stop()
      setPhase('error')
      setDetail(m.timedOut)
    }, POLL_TIMEOUT_MS)
    timer.current = setInterval(() => {
      void (async () => {
        try {
          const next = await getMemoryProviderOAuthStatus(provider, profile)

          if (generation.current !== attempt || next.state === 'pending') {
            return
          }

          stop()
          setConnected(next.connected)
          setAuth(next.auth)

          if (next.state === 'error') {
            setPhase('error')
            setDetail(next.detail || m.connectionFailed)
          } else {
            setPhase('idle')
          }
        } catch {
          // The deadline also bounds repeated transient failures.
        }
      })()
    }, POLL_MS)
  }, [m, profile, provider, stop])

  const cancel = useCallback(() => {
    stop()
    setPhase('idle')
  }, [stop])

  if (capable !== 'yes') {
    return null
  }

  const connectLabel = connected ? (auth === 'apikey' ? m.connectViaOAuth : m.reconnect) : m.connect

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {phase === 'idle' && connected && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Check className="size-3" />
          {auth === 'apikey' ? m.apiKeySet : m.oauthSet}
        </span>
      )}
      {phase === 'pending' ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {m.waitingBrowserConsent}
          </span>
          <Button className="h-auto p-0 text-xs" onClick={cancel} size="sm" type="button" variant="link">
            {m.cancelConnection}
          </Button>
        </>
      ) : (
        <Button
          className="h-auto gap-1 p-0 text-xs"
          onClick={() => void connect()}
          size="sm"
          type="button"
          variant="link"
        >
          <ExternalLink className="size-3" />
          {connectLabel}
        </Button>
      )}
      {phase === 'error' && detail && <span className="text-destructive">{detail}</span>}
    </span>
  )
}
