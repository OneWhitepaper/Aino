import { isNousCloudAgentUrl } from './backend-health'
import { NativeAuthChangedError } from './native-access-token'

interface CloudRecoveryDeps {
  hasNativeSession: (baseUrl: string) => boolean
  restoreCookieSession: (baseUrl: string) => Promise<boolean>
  onRecovered?: (baseUrl: string) => void
  now?: () => number
}

/** Coalesce the cookie refresh, never the single-use ticket minted afterward. */
export function createCloudSessionRecovery(deps: CloudRecoveryDeps) {
  const inflight = new Map<string, Promise<boolean>>()
  const failedAt = new Map<string, number>()
  const now = deps.now ?? Date.now
  let generation = 0

  const run = async <T>(baseUrl: string, mint: () => Promise<T>): Promise<T> => {
    const expectedGeneration = generation

    const assertCurrent = () => {
      if (expectedGeneration !== generation) {
        throw new NativeAuthChangedError()
      }
    }

    const hadNativeSession = deps.hasNativeSession(baseUrl)

    try {
      const result = await mint()
      assertCurrent()

      return result
    } catch (error) {
      assertCurrent()

      if (
        !isNousCloudAgentUrl(baseUrl) ||
        hadNativeSession ||
        deps.hasNativeSession(baseUrl) ||
        (error as { statusCode?: number })?.statusCode !== 401
      ) {
        throw error
      }

      let recovery = inflight.get(baseUrl)

      if (!recovery) {
        const failed = failedAt.get(baseUrl)

        if (failed !== undefined && now() - failed < 60_000) {
          throw error
        }

        recovery = Promise.resolve()
          .then(() => {
            assertCurrent()

            return deps.restoreCookieSession(baseUrl)
          })
          .catch(() => {
            assertCurrent()

            return false
          })
          .then(restored => {
            assertCurrent()

            if (!restored) {
              failedAt.set(baseUrl, now())
            }

            return restored
          })
          .finally(() => {
            if (inflight.get(baseUrl) === recovery) {
              inflight.delete(baseUrl)
            }
          })
        inflight.set(baseUrl, recovery)
      }

      const restored = await recovery
      assertCurrent()

      if (!restored) {
        throw error
      }

      // Native login may have changed while the background cookie flow ran.
      // Never turn that transition into a cross-identity fallback.
      if (deps.hasNativeSession(baseUrl)) {
        throw error
      }

      try {
        const ticket = await mint()
        assertCurrent()
        failedAt.delete(baseUrl)
        deps.onRecovered?.(baseUrl)

        return ticket
      } catch (retryError) {
        assertCurrent()
        failedAt.set(baseUrl, now())
        throw retryError
      }
    }
  }

  run.retire = () => {
    generation += 1
    inflight.clear()
    failedAt.clear()
  }

  return run
}
