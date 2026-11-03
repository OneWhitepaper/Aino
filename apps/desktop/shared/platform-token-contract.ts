export interface PlatformTokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
export interface PlatformTokenStore {
  load(origin: string): Promise<PlatformTokenSet | null>
  save(origin: string, tokens: PlatformTokenSet): Promise<'encrypted' | 'session_only'>
  clear(origin: string): Promise<void>
}
