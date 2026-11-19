import { capturePlatformDraftAuthority, type PlatformDraftAuthority } from '@/api/platform-session-binding'
import { translateNow } from '@/i18n'
import { assertCodeModelCompatible } from '@/lib/code-model-capability'
import { resolveModelDefault } from '@/lib/model-default'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { platformCreateOverrides } from '@/lib/platform-session-model'
import { getComposerModelSelection } from '@/store/composer-model-selection'
import { getDraftExecutionMode } from '@/store/execution-mode'
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
import { $currentCwdExplicit, getComposerSelectionGeneration, getComposerSelectionScope } from '@/store/session'

import { captureCreateSelection, type SessionCreateSelection } from './create-selection'

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

interface SessionCreateIntent {
  executionMode: 'work' | 'code'
  retainModelSelection?: boolean
  selection?: SessionCreateSelection
  cwdExplicit?: boolean
  isCurrent?: () => boolean
}

function captureExecutionWorkspaceParams(
  cwd: string,
  includeComposerSelection: boolean | 'defaults',
  intent?: SessionCreateIntent
) {
  const executionMode = intent?.executionMode ?? (includeComposerSelection ? getDraftExecutionMode() : 'work')
  const cwdExplicit = intent?.cwdExplicit ?? $currentCwdExplicit.get()

  if (executionMode === 'code' && (!cwd.trim() || !cwdExplicit)) {
    // The owner allocates a durable per-chat workspace. An inherited cwd is
    // not a project choice and must never turn into Code's writable root.
    return { execution_mode: executionMode, row_cwd: '' }
  }

  return {
    ...((intent || executionMode === 'code') && { execution_mode: executionMode }),
    ...(cwd && { cwd, cwd_explicit: cwdExplicit })
  }
}

export async function desktopSessionCreateParams(
  cwd: string,
  capturedRoute = resolveNewChatOwnerRoute(),
  requestedProfile?: string,
  legacyProfileIntent = false,
  includeComposerSelection: boolean | 'defaults' = true,
  intent?: SessionCreateIntent
): Promise<{
  params: Record<string, unknown>
  platformAuthority: PlatformDraftAuthority | null
  platformOwner: string
}> {
  const workspaceParams = captureExecutionWorkspaceParams(cwd, includeComposerSelection, intent)

  // Send captures user intent before any I/O. Manual selections never join
  // default resolution; their provider, owner, effort and fast mode travel
  // together even if another pick arrives during profile readiness.
  const picked = getComposerModelSelection()
  const selectionSource = picked.source
  const generation = getComposerSelectionGeneration()
  const selectionScope = getComposerSelectionScope()
  const draftOwner = JSON.stringify(resolveNewChatOwnerRoute())
  const selection = captureCreateSelection(includeComposerSelection, intent?.retainModelSelection, intent?.selection)
  let platformOwner = selection.platformOwner
  let platformOrigin = selection.platformOrigin
  let platformAuthority: PlatformDraftAuthority | null = null

  let codeSelection = { provider: selection.provider, model: selection.model }

  const profile = resolveCreateProfile(capturedRoute, requestedProfile)

  const scope = capturedRoute
    ? { connectionId: capturedRoute.connectionId, profile: capturedRoute.targetProfile || profile }
    : profile

  const managedRoute = capturedRoute
    ? { connectionId: capturedRoute.connectionId, profile }
    : platformDefaultScope(profile).route

  if (
    !intent?.retainModelSelection &&
    includeComposerSelection &&
    (includeComposerSelection === 'defaults' || selectionSource !== 'manual')
  ) {
    // A persisted default or a live session's footer is not billing authority.
    // Resolve the captured owner directly, even before background effects run.
    const resolved = await resolveModelDefault(scope, managedRoute)

    if (includeComposerSelection === true && generation !== getComposerSelectionGeneration()) {
      throw new Error(translateNow('desktop.modelSwitchFailed'))
    }

    codeSelection = { provider: resolved.provider, model: resolved.model }
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

  if (workspaceParams.execution_mode === 'code') {
    const account = catalog.account.get()
    const ownerScope = platformDefaultScope(scope).key
    await assertCodeModelCompatible({
      ...codeSelection,
      scope,
      platformModel: verifiedPlatformModel(codeSelection.model, platformOwner, platformOrigin),
      isCurrent: () =>
        (includeComposerSelection !== true ||
          (generation === getComposerSelectionGeneration() &&
            selectionScope === getComposerSelectionScope() &&
            JSON.stringify(picked) === JSON.stringify(getComposerModelSelection()) &&
            draftOwner === JSON.stringify(resolveNewChatOwnerRoute()))) &&
        account === catalog.account.get() &&
        ownerScope === platformDefaultScope(scope).key &&
        intent?.isCurrent?.() !== false
    })
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
      ...workspaceParams,
      ...(profile ? { profile: capturedRoute?.targetProfile || profile } : {}),
      ...modelParams,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(selection.serviceTier === 'ultrafast' ? { service_tier: 'ultrafast' } : {}),
      fast: selection.fast
    }
  }
}
