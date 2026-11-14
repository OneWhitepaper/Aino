import { hermesApiAs, type ResolvedOwner } from './client'

export interface MessagingOnboardingSession {
  pairing_id: string
  qr_payload: string
  expires_at: string
  poll_interval?: number
}

export interface MessagingOnboardingStatus {
  status: 'waiting' | 'scanned' | 'ready' | 'applied' | 'expired' | 'error'
  poll_interval?: number
  message?: string
}

export interface MessagingOnboardingApplied {
  ok: boolean
  platform: string
  needs_activation: boolean
}

export interface MessagingConnectResult {
  ok: boolean
  hot_served?: boolean
  needs_restart?: boolean
  state?: string
  message?: string
}

function onboardingPath(platform: string, suffix: string): string {
  return `/api/messaging/platforms/${encodeURIComponent(platform)}/onboarding/${suffix}`
}

// The server retains credentials. The renderer sees only a scoped, expiring QR receipt.
export function startMessagingOnboarding(platform: string, owner: ResolvedOwner): Promise<MessagingOnboardingSession> {
  return hermesApiAs(owner, { path: onboardingPath(platform, 'start'), method: 'POST', body: {}, timeoutMs: 45_000 })
}

export function getMessagingOnboarding(
  platform: string,
  pairingId: string,
  owner: ResolvedOwner
): Promise<MessagingOnboardingStatus> {
  return hermesApiAs(owner, { path: onboardingPath(platform, encodeURIComponent(pairingId)), timeoutMs: 45_000 })
}

export function applyMessagingOnboarding(
  platform: string,
  pairingId: string,
  owner: ResolvedOwner
): Promise<MessagingOnboardingApplied> {
  return hermesApiAs(owner, {
    path: onboardingPath(platform, `${encodeURIComponent(pairingId)}/apply`),
    method: 'POST',
    body: {}
  })
}

export function cancelMessagingOnboarding(
  platform: string,
  pairingId: string,
  owner: ResolvedOwner
): Promise<{ ok: boolean }> {
  return hermesApiAs(owner, { path: onboardingPath(platform, encodeURIComponent(pairingId)), method: 'DELETE' })
}

export function connectMessagingPlatform(platform: string, owner: ResolvedOwner): Promise<MessagingConnectResult> {
  return hermesApiAs(owner, {
    path: `/api/messaging/platforms/${encodeURIComponent(platform)}/connect`,
    method: 'POST',
    body: {}
  })
}
