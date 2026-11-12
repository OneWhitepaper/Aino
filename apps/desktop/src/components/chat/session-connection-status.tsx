import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useMemo, useState } from 'react'

import { platformAccountActions } from '@/api/platform'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { sessionRecoveryCopy } from '@/i18n/session-recovery'
import { useStoresSelector } from '@/lib/use-session-slice'
import { gatewayRouteState } from '@/store/gateway'
import { $primaryGatewayRoute } from '@/store/gateway-primary-route'
import { reconnectGateway } from '@/store/gateway-reconnect'
import { $gatewayRouteRevision } from '@/store/gateway-route-observation'
import { $notificationEpoch, notifyError } from '@/store/notifications'
import { $cronSessions, $messagingSessions, $sessions, $unlistedSessionOwnerRows } from '@/store/session'
import { captureSessionRecovery } from '@/store/session-recovery'
import type { SessionOwnerScope } from '@/store/session-request-router'
import { $sessionStates, $sessionTiles, knownOwnerForSession } from '@/store/session-states'

import { StatusRow } from './status-row'

interface SessionConnectionStatusProps {
  runtimeId: string | null | undefined
}

const NO_ACCOUNT = atom(null)

/** Observe only an already-owned route. Reading this status never dials or foregrounds it. */
export function SessionConnectionStatus({ runtimeId }: SessionConnectionStatusProps) {
  const epoch = useStore($notificationEpoch)
  const bridge = window.hermesDesktop?.platformAccount
  const account = useStore(bridge ? platformAccountActions(bridge).snapshot : NO_ACCOUNT)

  const ownerKey = useStoresSelector(
    [$sessionStates, $sessionTiles, $sessions, $cronSessions, $messagingSessions, $unlistedSessionOwnerRows],
    () => JSON.stringify(knownOwnerForSession(runtimeId) ?? null)
  )

  const owner: SessionOwnerScope = JSON.parse(ownerKey)

  if (!runtimeId || !owner) {
    return null
  }

  const route = typeof owner === 'string' ? { connectionId: null, profile: owner } : owner

  return (
    <OwnedConnectionStatus
      key={`${runtimeId}:${ownerKey}:${epoch}:${account?.account?.id}:${account?.revision}:${account?.mode}`}
      route={route}
      runtimeId={runtimeId}
    />
  )
}

interface OwnedConnectionStatusProps {
  route: { connectionId: string | null; profile: string }
  runtimeId: string
}

function OwnedConnectionStatus({ route, runtimeId }: OwnedConnectionStatusProps) {
  const { locale } = useI18n()
  const copy = sessionRecoveryCopy(locale)
  const { connectionId, profile } = route

  const target = useMemo(
    () => ({ connectionId, profile, ...captureSessionRecovery(runtimeId) }),
    [connectionId, profile, runtimeId]
  )

  const state = useStoresSelector(
    [$gatewayRouteRevision, $primaryGatewayRoute],
    () => gatewayRouteState(route.connectionId, route.profile).state
  )

  const [recoveryState, setRecoveryState] = useState<'none' | 'lost' | 'restored'>('none')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (state === 'closed' || state === 'error') {
      setRecoveryState('lost')
    } else if (state === 'open') {
      setRecoveryState(previous => (previous === 'lost' ? 'restored' : previous))
    }
  }, [state])

  useEffect(() => {
    if (recoveryState !== 'restored') {
      return
    }

    const timer = window.setTimeout(() => setRecoveryState('none'), 8_000)

    return () => window.clearTimeout(timer)
  }, [recoveryState])

  if (!target.isCurrent() || !state || (state === 'open' && recoveryState !== 'restored' && !pending)) {
    return null
  }

  const reconnect = async () => {
    if (pending || !target.isCurrent()) {
      return
    }

    setPending(true)

    try {
      await reconnectGateway({ target })
    } catch (error) {
      if (target.isCurrent()) {
        notifyError(error, copy.reconnect)
      }
    } finally {
      setPending(false)
    }
  }

  const connecting = state === 'connecting' || pending

  return (
    <div data-slot="session-connection-status" role="status">
      <StatusRow
        leading={<Codicon name={state === 'open' && !pending ? 'check' : 'plug'} />}
        trailing={
          state !== 'open' && (
            <Button
              disabled={connecting}
              loading={pending}
              onClick={() => void reconnect()}
              size="micro"
              variant="text"
            >
              {copy.reconnect}
            </Button>
          )
        }
        trailingVisible
      >
        <span className="min-w-0 text-xs text-(--ui-text-secondary)">
          {connecting ? copy.reconnecting : state === 'open' ? copy.restored : copy.disconnected}
        </span>
      </StatusRow>
    </div>
  )
}
