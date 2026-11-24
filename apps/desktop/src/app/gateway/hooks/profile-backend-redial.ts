import { LOCAL_CONNECTION_ID, reconnectBackoffDelayMs } from '@hermes/shared'

import type { HermesConnection } from '@/global'
import { isActivePrimary, primaryGatewayProfile, redialProfileGateway } from '@/store/gateway'
import { foregroundShows, normalizeProfileKey } from '@/store/profile'

/**
 * A plugin moved one profile's backend (host.setProfileBackend /
 * clearProfileBackend): redial only that profile's socket, in place, so the
 * page never blanks and the window stays on the profile it shows. Which socket
 * serves the profile is this window's own record; main's primary can differ
 * after a renderer reload. False: run the full switch instead.
 *
 * The profile is one of THIS computer's. `otherGateway`: the window's primary
 * socket is a registered gateway's, whose profile of the same name did not
 * move. That socket and whatever the window shows through it stay as they are;
 * only a socket the window dialed for the local profile itself is redialed.
 */
// The newest move of a profile owns its redial.
const redialTurns = new Map<string, number>()

export async function redialMovedProfile(
  profile: string,
  redialPrimary: (profile: string) => Promise<boolean>,
  otherGateway: boolean,
  stopped: () => boolean
): Promise<boolean> {
  const turn = (redialTurns.get(profile) ?? 0) + 1

  redialTurns.set(profile, turn)

  try {
    if (!otherGateway && profile === normalizeProfileKey(primaryGatewayProfile())) {
      // A socket the window dialed for the profile beside its primary one moved too.
      await redialProfileGateway(profile)

      return await redialPrimary(profile)
    }
  } catch (error) {
    console.warn(`[gateway] redial of "${profile}" after its backend moved failed`, error)

    return true
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      // The redial moves the window only while it shows the profile, and
      // after a pick that is still connecting has landed.
      const shown = await foregroundShows(profile)

      await redialProfileGateway(profile, { shown: shown && !(otherGateway && isActivePrimary()) })

      return true
    } catch (error) {
      console.warn(`[gateway] redial of "${profile}" after its backend moved failed`, error)
    }

    // The route could not be read, so a profile the window shows through the
    // primary socket is still on the backend it left (this computer's own,
    // when a plugin took the profile over). Ask again, with the reconnect
    // backoff. A profile that reached a socket of its own meanwhile is left
    // on it, one the window no longer shows asks nothing, and a redial that
    // waited here stops once the profile has moved again.
    await new Promise(resolve => setTimeout(resolve, reconnectBackoffDelayMs(attempt)))

    if (stopped() || redialTurns.get(profile) !== turn || !isActivePrimary()) {
      return true
    }
  }
}

/** A registered gateway on another machine, not this computer's own backend ("This device"). */
export function isOtherGateway(connection: HermesConnection | null): boolean {
  return Boolean(
    connection?.registryScoped && connection.connectionId && connection.connectionId !== LOCAL_CONNECTION_ID
  )
}
