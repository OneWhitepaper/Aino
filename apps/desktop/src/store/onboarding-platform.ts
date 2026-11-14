import type { OnboardingStartParams, OnboardingStartResult } from '@hermes/shared'

import { bindSelectedPlatformSession } from '@/api/platform-session-binding'
import { desktopSessionCreateParams } from '@/app/session/hooks/use-session-actions/create-params'
import { PlatformSelectionError } from '@/store/platform-models'

import type { OnboardingRequest } from './onboarding-run'
import type { SessionOwnerRoute } from './session-request-router'

/** Onboarding uses the same captured account/model authority as an ordinary new chat. */
export async function startPlatformOnboarding(
  request: OnboardingRequest,
  params: OnboardingStartParams & Record<string, unknown>,
  timeout?: number,
  skipped: () => boolean = () => false,
  owner?: SessionOwnerRoute
): Promise<OnboardingStartResult> {
  if (window.hermesDesktop?.accountAdapter !== 'platform') {
    return request('onboarding.start', params, timeout)
  }

  const prepared = await desktopSessionCreateParams('', owner ?? null, 'default', !owner)
  const authority = prepared.platformAuthority
  const managed = prepared.params.model_source === 'aino'

  if (managed && !authority) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  const startParams = managed
    ? {
        ...params,
        model_source: 'aino' as const,
        model_id: String(prepared.params.model_id),
        platform_owner: authority!.owner
      }
    : params

  const started = await request<OnboardingStartResult>('onboarding.start', startParams, timeout)

  if (!started.managed_model_pending || skipped()) {
    return started
  }

  if (!managed || !authority) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  await bindSelectedPlatformSession(
    owner ?? 'default',
    started.session_id,
    {
      modelId: String(prepared.params.model_id),
      ownerUserId: prepared.platformOwner,
      platformOrigin: authority.owner.platform_origin,
      status: 'awaiting_managed_credentials'
    },
    request,
    true,
    authority.account
  )

  if (skipped()) {
    return started
  }

  return request('onboarding.start', { ...startParams, fresh_launch: false, rerun: false }, timeout)
}
