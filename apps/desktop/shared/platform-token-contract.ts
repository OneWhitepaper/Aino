import type { PlatformModel } from './platform-contract'

export interface PlatformDeviceKey {
  key_id: string
  device_id: string
  version: number
  status: 'active' | 'revoked'
  expires_at: null
  api_key?: string
}
export interface StoredPlatformDeviceKey extends PlatformDeviceKey {
  user_id: string
  api_key: string
}
export interface PlatformTokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number
  deviceKeys?: StoredPlatformDeviceKey[]
  deviceModels?: PlatformModel[]
  deviceAccount?: { id: string; display_name: string; phone_masked: string; email: string }
  suspendedDevices?: Array<{ user_id: string; device_id: string }>
}
export interface PlatformTokenStore {
  load(origin: string): Promise<PlatformTokenSet | null>
  save(origin: string, tokens: PlatformTokenSet): Promise<'encrypted' | 'session_only'>
  clear(origin: string): Promise<void>
}
