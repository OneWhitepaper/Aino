import { capturePlatformDraftAuthority, type PlatformDraftAuthority } from '@/api/platform-session-binding'
import { translateNow } from '@/i18n'
import { resolveModelDefault } from '@/lib/model-default'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { platformCreateOverrides } from '@/lib/platform-session-model'
import { managedModelRouteCapability } from '@/store/gateway-managed-capability'
import { verifiedPlatformModel } from '@/store/platform-model-capability'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'
import {
  $activeGatewayProfile,
  $newChatProfile,
  ensureGatewayAgent,
  ensureGatewayProfile,
  normalizeProfileKey,
  resolveNewChatOwnerRoute
} from '@/store/profile'
import {
  $currentCwdExplicit,
  $currentFastMode,
  $currentModel,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $currentProvider,
  $currentReasoningEffort,
  $currentServiceTier,
  getComposerSelectionGeneration,
  getCurrentModelSource
} from '@/store/session'

// `session.create` params from the current draft's owner and model/effort/fast,
// ensuring the gateway is on that profile first. Shared by the primary send path
// and the "open in split" tile path; `cwd` is the one thing that differs (the
// live composer cwd for a send, the resolved new-session cwd for a fresh tile).
//
// Resolving null profile to the active gateway's is load-bearing: in global-remote
// mode one backend serves every profile, so an omitted profile silently lands the
// chat on the launch (default) profile — the "rubberbands back to default" bug.
// A no-op for single-profile/local-pooled users (a backend resolves its own launch
// profile to None). Effort/fast still ride as per-session overrides. Model and
// provider only ride when the composer source is 'manual', except an Aino
// default: it must carry its managed-billing identity into draft binding.
// Other default-sourced values mirror Settings → Model and must not pin the
// new chat. Independent tiles pass `defaults` to resolve their own Settings
// without inheriting or changing the occupied conversation's selection; Bot
// tabs retain their existing false path with no composer overrides.
function resolveCreateProfile(
  capturedRoute: ReturnType<typeof resolveNewChatOwnerRoute>,
  requestedProfile?: string
): string {
  const profile =
    capturedRoute?.profile ||
    requestedProfile ||
    $newChatProfile.get() ||
    normalizeProfileKey($activeGatewayProfile.get())

  return profile
}

async function capturePlatformCreateAuthority(
  platformOwner: string,
  platformOrigin: string,
  generation: number,
  enforceGeneration: boolean
): Promise<PlatformDraftAuthority> {
  const authority = await capturePlatformDraftAuthority(platformOwner, platformOrigin)

  if (enforceGeneration && generation !== getComposerSelectionGeneration()) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  return authority
}

export async function desktopSessionCreateParams(
  cwd: string,
  capturedRoute = resolveNewChatOwnerRoute(),
  requestedProfile?: string,
  legacyProfileIntent = false,
  includeComposerSelection: boolean | 'defaults' = true
): Promise<{
  params: Record<string, unknown>
  platformAuthority: PlatformDraftAuthority | null
  platformOwner: string
}> {
  // Send captures user intent before any I/O. Manual selections never join
  // default resolution; their provider, owner, effort and fast mode travel
  // together even if another pick arrives during profile readiness.
  const selectionSource = getCurrentModelSource()
  const generation = getComposerSelectionGeneration()
  let platformOwner = $currentPlatformOwner.get()
  let platformOrigin = $currentPlatformOrigin.get()
  let platformAuthority: PlatformDraftAuthority | null = null

  const selection = {
    effort: includeComposerSelection === true ? $currentReasoningEffort.get().trim() : '',
    fast: $currentFastMode.get(),
    serviceTier: $currentServiceTier.get().trim(),
    model: $currentModel.get().trim(),
    provider: $currentProvider.get().trim()
  }

  const profile = resolveCreateProfile(capturedRoute, requestedProfile)

  const scope = capturedRoute
    ? { connectionId: capturedRoute.connectionId, profile: capturedRoute.targetProfile || profile }
    : profile

  const managedRoute = capturedRoute
    ? { connectionId: capturedRoute.connectionId, profile }
    : platformDefaultScope(profile).route

  if (includeComposerSelection && (includeComposerSelection === 'defaults' || selectionSource !== 'manual')) {
    // A persisted default or a live session's footer is not billing authority.
    // Resolve the captured owner directly, even before background effects run.
    const resolved = await resolveModelDefault(scope, managedRoute)

    if (includeComposerSelection === true && generation !== getComposerSelectionGeneration()) {
      throw new Error(translateNow('desktop.modelSwitchFailed'))
    }

    selection.model = resolved.platform?.modelId || ''
    selection.provider = resolved.platform ? 'aino' : ''
    platformOwner = resolved.platform?.ownerUserId || ''
    platformOrigin = resolved.platform?.platformOrigin || ''
  }

  if (capturedRoute) {
    await ensureGatewayAgent(capturedRoute.connectionId, profile)
  } else if (legacyProfileIntent) {
    await ensureGatewayProfile(profile, { forceLegacyRoute: true })
  } else {
    await ensureGatewayProfile(profile)
  }

  if (!includeComposerSelection) {
    return {
      platformOwner: '',
      platformAuthority: null,
      params: {
        cols: 96,
        source: 'desktop',
        ...(cwd && { cwd }),
        ...(profile ? { profile: capturedRoute?.targetProfile || profile } : {})
      }
    }
  }

  if (selection.provider === 'aino' && managedModelRouteCapability(managedRoute) !== 'supported') {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  const catalog = platformModelCatalog()

  if (selection.provider === 'aino') {
    platformAuthority = await capturePlatformCreateAuthority(
      platformOwner,
      platformOrigin,
      generation,
      includeComposerSelection === true
    )
    platformOwner = platformAuthority.owner.user_id
    platformOrigin = platformAuthority.owner.platform_origin
  }

  const modelParams = platformCreateOverrides(
    selection.provider,
    selection.model,
    platformOwner,
    catalog.account.get(),
    catalog.state.get().models
  )

  const reasoningEffort =
    selection.provider !== 'aino' ||
    verifiedPlatformModel(selection.model, platformOwner, platformOrigin)?.capabilities.reasoning
      ? selection.effort
      : ''

  return {
    platformOwner,
    platformAuthority,
    params: {
      cols: 96,
      source: 'desktop',
      ...(cwd && { cwd, cwd_explicit: $currentCwdExplicit.get() }),
      ...(profile ? { profile: capturedRoute?.targetProfile || profile } : {}),
      ...modelParams,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(selection.serviceTier === 'ultrafast' ? { service_tier: 'ultrafast' } : {}),
      fast: selection.fast
    }
  }
}
