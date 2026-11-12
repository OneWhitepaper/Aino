import './account-wallet.css'

import { useCallback, useEffect, useRef, useState } from 'react'

import { platformBillingQueryKey } from '@/api/platform'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { ChevronRight, Monitor, RefreshCw } from '@/lib/icons'
import { queryClient } from '@/lib/query-client'

import type {
  PlatformAccountBridge,
  PlatformBillingScope,
  PlatformDevice,
  PlatformDevicesBridge
} from '../../../../shared/platform-contract'
import { ListRowSkeleton, SettingsGroup } from '../primitives'

import { DeviceAuthorizationList } from './device-authorization-list'

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

function mergeDeviceAuthorizations(rows: PlatformDevice[], previous: PlatformDevice[] = []) {
  const revoked = new Map(
    previous.filter(device => device.status === 'revoked').map(device => [device.device_id, device.expires_at])
  )

  return rows.map(device => {
    // Legacy revocation can update last_used_at; only an expired, revoked response needs disambiguation.
    return !device.status &&
      device.revoked &&
      device.expires_at !== null &&
      Date.parse(device.expires_at) <= Date.now() &&
      revoked.get(device.device_id) === device.expires_at
      ? { ...device, status: 'revoked' as const }
      : device
  })
}

function DeviceList({ scope, bridge, accountBridge }: PlatformDevicesProps & { bridge: PlatformDevicesBridge }) {
  const { t } = useI18n()
  const copy = t.platformDevices
  const { user_id: user, generation, origin } = scope

  const [devices, setDevices] = useState<PlatformDevice[] | null>(
    () => queryClient.getQueryData<PlatformDevice[]>([...platformBillingQueryKey(scope), 'devices']) ?? null
  )

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
      const queryKey = [...platformBillingQueryKey({ origin, user_id: user, generation }), 'devices']

      const rows = await queryClient.fetchQuery({
        queryKey,
        staleTime: 0,
        retry: false,
        networkMode: 'always',
        queryFn: async () =>
          mergeDeviceAuthorizations(
            await bridge.list({ expected_user_id: user, expected_generation: generation }),
            queryClient.getQueryData<PlatformDevice[]>(queryKey)
          )
      })

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
  }, [bridge, generation, origin, user])

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
        const queryKey = [...platformBillingQueryKey(scope), 'devices']
        await queryClient.cancelQueries({ queryKey, exact: true })

        const confirmed = queryClient.setQueryData<PlatformDevice[]>(queryKey, rows =>
          rows?.map(device => (device.device_id === id ? { ...device, status: 'revoked', revoked: true } : device))
        )

        setDevices(confirmed ?? null)
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
    <details className="account-devices">
      <summary>
        <Monitor aria-hidden="true" />
        <span className="account-devices-heading">
          <span>{copy.title}</span>
          <span>{t.accountPage.devicesDescription}</span>
        </span>
        <ChevronRight aria-hidden="true" className="account-devices-chevron" />
      </summary>
      <div className="account-devices-body">
        <div className="account-devices-toolbar">
          <Button disabled={loading || busy} onClick={() => void read()} size="sm" variant="ghost">
            <RefreshCw />
            {copy.refresh}
          </Button>
        </div>
        {loading && !devices && (
          <SettingsGroup aria-busy="true" aria-label={t.common.loading} role="status">
            <ListRowSkeleton />
            <ListRowSkeleton />
          </SettingsGroup>
        )}
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
          <DeviceAuthorizationList
            devices={devices}
            disabled={busy || loading || !!stepUp}
            onSelect={id => {
              setSelected(id)
              setError(null)
            }}
          />
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
      </div>
    </details>
  )
}
