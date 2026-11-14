import path from 'node:path'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'
import type { PlatformDeviceInfo } from '../shared/platform-contract'

import { appVersionInfo, nativeAboutVersion } from './app-version'
import type { InstallStamp } from './install-stamp'
import { resolveDesktopClientVersion } from './local-runtime-version'
import { resolveNativeComputerName } from './platform-device-name'
import { validateDiagnosticBundle } from './platform-diagnostics-contract'
import { createPlatformTokenStore, type PlatformTokenStoreCrypto } from './platform-token-store'

export function nativePlatformDeviceInfo(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  version: string,
  computerName: string
): PlatformDeviceInfo {
  return {
    installation_name: computerName,
    os: platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux',
    client_type: isPackaged ? 'desktop' : 'desktop_dev',
    client_version: version
  }
}

interface NativeDeviceInfoOptions {
  platform: NodeJS.Platform
  isPackaged: boolean
  stamp: Readonly<InstallStamp> | null
  root: string
  hermesHome: string
  packageVersion: string
}

export async function resolveNativePlatformDeviceInfo(options: NativeDeviceInfoOptions): Promise<PlatformDeviceInfo> {
  const { platform, isPackaged, stamp, root, hermesHome, packageVersion } = options

  const [version, computerName] = await Promise.all([
    resolveDesktopClientVersion(stamp, root, hermesHome, packageVersion),
    resolveNativeComputerName(platform)
  ])

  return nativePlatformDeviceInfo(
    platform,
    isPackaged,
    version || nativeAboutVersion(appVersionInfo(stamp, '', packageVersion)),
    computerName
  )
}

export function createNativePlatformAuth(
  origin: { origin: string; development: boolean },
  userData: string,
  crypto: PlatformTokenStoreCrypto,
  deviceId: () => string,
  deviceInfo?: () => PlatformDeviceInfo | Promise<PlatformDeviceInfo>
) {
  const client = createPlatformClient({
    origin: origin.origin,
    validateDiagnostics: validateDiagnosticBundle,
    allowInsecureLoopback: origin.development
  })

  const tokenStore = createPlatformTokenStore({ filePath: path.join(userData, 'platform-tokens.json'), crypto })
  let metadata: Promise<PlatformDeviceInfo> | undefined

  const resolveInfo = deviceInfo
    ? () =>
        (metadata ??= Promise.resolve()
          .then(deviceInfo)
          .catch(error => {
            metadata = undefined

            throw error
          }))
    : undefined

  return {
    client,
    auth: createPlatformAuth({
      client,
      tokenStore,
      now: Date.now,
      nativeDeviceId: deviceId,
      nativeDeviceInfo: resolveInfo
    })
  }
}
