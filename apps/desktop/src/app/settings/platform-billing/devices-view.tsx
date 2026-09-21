import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import { Monitor, RefreshCw } from '@/lib/icons'

import type {
  PlatformAccountBridge,
  PlatformBillingScope,
  PlatformDevice,
  PlatformDevicesBridge
} from '../../../../shared/platform-contract'
import { SettingsGroup, SettingsSection } from '../primitives'

export interface PlatformDevicesProps {
  scope: PlatformBillingScope
  bridge?: PlatformDevicesBridge
  accountBridge?: Pick<PlatformAccountBridge, 'submitStepUp'>
}

export function PlatformDevices({
  scope,
  bridge = window.hermesDesktop?.platformDevices,
  accountBridge = window.hermesDesktop?.platformAccount
}: PlatformDevicesProps) {
  if (!bridge) {
    return null
  }

  return (
    <DeviceList
      accountBridge={accountBridge}
      bridge={bridge}
      key={JSON.stringify([scope.origin, scope.user_id, scope.generation])}
      scope={scope}
    />
  )
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'network_error'
}

function pageVisible() {
  return document.visibilityState !== 'hidden'
}

function DeviceList({ scope, bridge, accountBridge }: PlatformDevicesProps & { bridge: PlatformDevicesBridge }) {
  const { t, locale } = useI18n()
  const copy = t.platformDevices
  const { user_id: user, generation } = scope
  const [devices, setDevices] = useState<PlatformDevice[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revoked, setRevoked] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [stepUp, setStepUp] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const alive = useRef(false)
  const readRevision = useRef(0)
  const pendingMutation = useRef(false)

  const read = useCallback(async () => {
    if (!alive.current || !pageVisible()) {
      return
    }

    const revision = ++readRevision.current
    setLoading(true)
    setError(null)

    try {
      const rows = await bridge.list({ expected_user_id: user, expected_generation: generation })

      if (alive.current && revision === readRevision.current && pageVisible()) {
        setDevices(rows)
      }
    } catch (failure) {
      if (alive.current && revision === readRevision.current) {
        setError(errorCode(failure))
      }
    } finally {
      if (alive.current && revision === readRevision.current) {
        setLoading(false)
      }
    }
  }, [bridge, generation, user])

  // This ref tracks component lifetime, not a mirrored account or renderer state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    alive.current = true

    const visible = () => {
      void read()
    }

    void read()
    document.addEventListener('visibilitychange', visible)

    return () => {
      alive.current = false
      // Invalidate reads started before this lifecycle ended, including StrictMode remounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      readRevision.current++
      document.removeEventListener('visibilitychange', visible)
    }
  }, [read])

  async function revoke() {
    if (!selected || pendingMutation.current) {
      return
    }

    pendingMutation.current = true
    setBusy(true)
    setError(null)
    setRevoked(false)
    const id = selected

    try {
      await bridge.revoke({ device_id: id, expected_user_id: user, expected_generation: generation })

      if (alive.current) {
        setSelected(null)
        setRevoked(true)
        await read()
      }
    } catch (failure) {
      if (alive.current) {
        setSelected(null)
        const reason = errorCode(failure)
        setError(reason)

        if (reason === 'STEP_UP_REQUIRED') {
          setStepUp(id)
        }
      }

      throw new Error(copy.failed)
    } finally {
      pendingMutation.current = false

      if (alive.current) {
        setBusy(false)
      }
    }
  }

  async function verify() {
    if (!stepUp || pendingMutation.current || !code.trim() || !accountBridge) {
      return
    }

    pendingMutation.current = true
    setBusy(true)
    setError(null)

    try {
      await accountBridge.submitStepUp({
        totp_code: code.trim(),
        expected_user_id: user,
        expected_generation: generation
      })

      if (alive.current) {
        setSelected(stepUp)
        setStepUp(null)
      }
    } catch (failure) {
      if (alive.current) {
        setError(errorCode(failure))
      }
    } finally {
      pendingMutation.current = false

      if (alive.current) {
        setBusy(false)
        setCode('')
      }
    }
  }

  const reauthenticate =
    error === 'RECENT_AUTH_REQUIRED' || error === 'not_authenticated' || error === 'refresh_token_revoked'

  return (
    <SettingsSection
      aside={
        <Button disabled={loading || busy} onClick={() => void read()} size="sm" variant="ghost">
          <RefreshCw />
          {copy.refresh}
        </Button>
      }
      icon={Monitor}
      title={copy.title}
    >
      {loading && !devices && <Loader />}
      {revoked && (
        <p className="mb-3 text-sm" role="status">
          {copy.success}
        </p>
      )}
      {error && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {reauthenticate
            ? copy.reauthenticate
            : error === 'STEP_UP_REQUIRED'
              ? copy.stepUp
              : t.settings.account.platformError(error)}
        </p>
      )}
      {stepUp && (
        <form
          className="mb-4 grid gap-3"
          onSubmit={event => {
            event.preventDefault()
            void verify()
          }}
        >
          <Input
            aria-label={copy.code}
            autoComplete="one-time-code"
            disabled={busy}
            inputMode="numeric"
            maxLength={64}
            onChange={event => setCode(event.target.value)}
            value={code}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !code.trim() || !accountBridge} size="sm" type="submit">
              {copy.verify}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setStepUp(null)
                setCode('')
                setError(null)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t.common.cancel}
            </Button>
          </div>
        </form>
      )}
      {devices?.length === 0 && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
      {devices && devices.length > 0 && (
        <SettingsGroup role="list">
          {devices.map(device => (
            <div className="min-w-0 py-3" data-settings-row="" key={device.device_id} role="listitem">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{device.device_id}</span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">{device.revoked ? copy.revoked : copy.active}</span>
                  <Button
                    disabled={device.revoked || busy || loading || !!stepUp}
                    onClick={() => {
                      setSelected(device.device_id)
                      setError(null)
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {copy.revoke}
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {copy.lastUsed}: {new Date(device.last_used_at).toLocaleString(locale)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {copy.expires}: {new Date(device.expires_at).toLocaleString(locale)}
              </p>
            </div>
          ))}
        </SettingsGroup>
      )}
      {selected && (
        <ConfirmDialog
          confirmLabel={copy.revoke}
          description={copy.confirmDescription}
          destructive
          onClose={() => setSelected(null)}
          onConfirm={revoke}
          open
          title={copy.confirmTitle}
        />
      )}
    </SettingsSection>
  )
}
