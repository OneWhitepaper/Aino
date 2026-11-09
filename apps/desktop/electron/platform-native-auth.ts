import path from 'node:path'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'

import { validateDiagnosticBundle } from './platform-diagnostics-contract'
import { createPlatformTokenStore, type PlatformTokenStoreCrypto } from './platform-token-store'

export function createNativePlatformAuth(
  origin: { origin: string; development: boolean },
  userData: string,
  crypto: PlatformTokenStoreCrypto,
  deviceId: () => string
) {
  const client = createPlatformClient({
    origin: origin.origin,
    validateDiagnostics: validateDiagnosticBundle,
    allowInsecureLoopback: origin.development
  })
  const tokenStore = createPlatformTokenStore({ filePath: path.join(userData, 'platform-tokens.json'), crypto })

  return { client, auth: createPlatformAuth({ client, tokenStore, now: Date.now, nativeDeviceId: deviceId }) }
}
