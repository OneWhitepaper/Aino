import { platformAccountActions } from '@/api/platform'
import { type PlatformDraftAuthority } from '@/api/platform-session-binding'
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

// `session.create` params from the current profile + sticky-UI model/effort/fast,
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
// new chat.
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

export async function desktopSessionCreateParams(
  cwd: string,
  capturedRoute = resolveNewChatOwnerRoute(),
  requestedProfile?: string,
  legacyProfileIntent = false,
  includeComposerSelection = true
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
    effort: $currentReasoningEffort.get().trim(),
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

  if (includeComposerSelection && selectionSource !== 'manual') {
    // A persisted default or a live session's footer is not billing authority.
    // Resolve the captured owner directly, even before background effects run.
    const resolved = await resolveModelDefault(scope, managedRoute)

    if (generation !== getComposerSelectionGeneration()) {
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
    const accountBridge = window.hermesDesktop?.platformAccount

    if (accountBridge) {
      // A picker can precede a missed IPC account publication. Refresh before
      // capturing draft authority so the native revision and owner agree.
      await platformAccountActions(accountBridge).refresh()
    }

    await catalog.load()
    const authoritativeOwner = catalog.owner.state.get().owner
    const account = catalog.account.get()

    if (
      generation !== getComposerSelectionGeneration() ||
      !authoritativeOwner ||
      account?.phase !== 'signed_in' ||
      account.account?.id !== authoritativeOwner.user_id ||
      !platformOwner ||
      !platformOrigin ||
      platformOwner !== authoritativeOwner.user_id ||
      platformOrigin !== authoritativeOwner.platform_origin
    ) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    platformOwner = authoritativeOwner.user_id
    platformOrigin = authoritativeOwner.platform_origin
    platformAuthority = { account, owner: authoritativeOwner }
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
