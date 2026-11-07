import { platformModelCatalog } from './platform-models'
import { $sessionStates } from './session-states'

/** A foreign platform session remains locally readable, but its identity is immutable. */
export function platformHistoryOwner(sessionId?: string | null): string | null {
  const model = sessionId ? $sessionStates.get()[sessionId]?.platformModel : undefined
  const owner = platformModelCatalog().owner.state.get().owner

  return model &&
    (!model.platformOrigin || model.ownerUserId !== owner?.user_id || model.platformOrigin !== owner.platform_origin)
    ? model.ownerUserId
    : null
}
