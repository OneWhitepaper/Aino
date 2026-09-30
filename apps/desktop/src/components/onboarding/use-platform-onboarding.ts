import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { $activeGatewayConnectionId, $activeGatewayRoute } from '@/store/gateway'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { platformModelCatalog } from '@/store/platform-models'

/** A platform session can be ready without configuring a persistent BYOK provider. */
export function usePlatformOnboardingReady(enabled: boolean): boolean {
  const catalog = platformModelCatalog()
  const account = useStore(catalog.account)
  const state = useStore(catalog.state)
  const profile = useStore($activeGatewayRoute)
  const connectionId = useStore($activeGatewayConnectionId)
  const capabilities = useStore($gatewayManagedCapabilities)
  const [verified, setVerified] = useState<{ catalog: typeof catalog; scope: string } | null>(null)

  const supported =
    managedModelRouteCapabilityFrom(capabilities, {
      connectionId,
      profile
    }) === 'supported'

  const signedIn = account?.phase === 'signed_in' && Boolean(account.account)
  const scope = account?.account ? JSON.stringify([account.account.id, account.mode, connectionId, profile]) : null

  const recovering =
    account?.phase === 'offline' ||
    account?.phase === 'loading' ||
    (signedIn && (state.phase === 'idle' || state.phase === 'loading'))

  const ready =
    supported &&
    signedIn &&
    state.phase === 'ready' &&
    state.models.some(model => model.state === 'available' && model.capabilities.tools)

  useEffect(() => {
    setVerified(previous => {
      const sameOwner = previous?.catalog === catalog && previous.scope === scope

      if (ready && scope) {
        return sameOwner ? previous : { catalog, scope }
      }

      return recovering && supported && sameOwner ? previous : null
    })
  }, [catalog, ready, recovering, scope, supported])

  useEffect(() => {
    if (enabled && supported && signedIn && state.phase === 'idle') {
      void catalog.load()
    }
  }, [catalog, enabled, signedIn, state.phase, supported])

  // Retain only this surface's verified onboarding state while the same owner
  // recovers. Catalog/selection auth stays fail-closed and nothing is persisted.
  const retained = recovering && verified?.catalog === catalog && verified.scope === scope

  return enabled && supported && (ready || retained)
}
