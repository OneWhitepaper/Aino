import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Slot as ContribSlot } from '@/contrib/react/slot'
import { useStoresSelector } from '@/lib/use-session-slice'
import { $activeGatewayConnectionId, $activeGatewayRoute } from '@/store/gateway'
import { $sessionStates } from '@/store/session-states'

import { COMPOSER_AREAS } from './contrib'
import { ComposerSessionProvider, useComposerScope } from './scope'

/** The `composer.top` banner seam, told which session's composer it sits in: contributions read
 *  it through `useComposerSession` (the SDK door), the runtime id mapped to its stored id. */
export function ComposerTopSlot({ sessionId: id }: { sessionId?: null | string }) {
  const sessionId = id ?? null
  const scope = useComposerScope()
  const activeConnectionId = useStore($activeGatewayConnectionId)
  const activeProfile = useStore($activeGatewayRoute)
  const connectionId = scope.connectionId === undefined ? activeConnectionId : scope.connectionId
  const profile = scope.profile ?? activeProfile

  const storedSessionId = useStoresSelector([$sessionStates], () =>
    sessionId ? ($sessionStates.get()[sessionId]?.storedSessionId ?? sessionId) : null
  )

  const value = useMemo(
    () => ({ sessionId, storedSessionId, owner: { connectionId, profile } }),
    [sessionId, storedSessionId, connectionId, profile]
  )

  return (
    <ComposerSessionProvider value={value}>
      <ContribSlot area={COMPOSER_AREAS.top} />
    </ComposerSessionProvider>
  )
}
