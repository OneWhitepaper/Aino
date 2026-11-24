import { useStore } from '@nanostores/react'

import { $backendTransitions, transitionScopeKey } from '@/store/backend-transition'
import { $activeGatewayConnectionId } from '@/store/gateway'
import { launcherPluginFor } from '@/store/launcher-transition'
import { $connection } from '@/store/session'

export function useBackendTransition(profile: null | string | undefined, connectionId?: null | string) {
  const activeConnectionId = useStore($activeGatewayConnectionId)
  const transitions = useStore($backendTransitions)
  const connection = useStore($connection)
  const source = connectionId === undefined ? activeConnectionId : connectionId

  // A legacy remote and a local plugin launcher both use remote transport;
  // only the launcher belongs to this computer's transition authority.
  if (!source && connection?.mode === 'remote' && !launcherPluginFor(profile)) {
    return null
  }

  return transitions[transitionScopeKey(profile, source)] ?? null
}
