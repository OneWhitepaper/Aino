import type { ModelOptionsResult } from '@hermes/shared'

import { createGatewaySession } from '@/app/session/hooks/use-session-actions/session-create-request'
import { getGlobalModelInfo } from '@/hermes'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import {
  type CanonicalModelRow,
  type PlatformSessionModel,
  unselectedCanonicalModelRow
} from '@/lib/platform-session-model'
import { $botChatSessionIds } from '@/store/bot-chat-scope'
import { type PlatformModelOwner, samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, PlatformSelectionError, requirePlatformSelection } from '@/store/platform-models'
import { profileScopeForSessionOwner, type SessionOwnerScope } from '@/store/session-request-router'
import { $sessionStates, publishSessionState, sessionTileDelegate } from '@/store/session-states'
import type { SessionCreateResponse } from '@/types/hermes'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'
import type { PlatformAccountSnapshot, PlatformModelPurpose } from '../../shared/platform-contract'

import { platformAccountActions } from './platform'
import type { ConversationModelRow } from './platform-conversation-models'
import { bindPlatformModel } from './platform-models'
import { getSession } from './sessions'

type Request = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>

export interface PlatformDraftAuthority {
  account: PlatformAccountSnapshot
  owner: PlatformModelOwner
}

/** Capture the native account authority after resolving a draft's model default. */
export async function capturePlatformDraftAuthority(
  platformOwner: string,
  platformOrigin: string
): Promise<PlatformDraftAuthority> {
  const accountBridge = window.hermesDesktop?.platformAccount

  if (accountBridge) {
    await platformAccountActions(accountBridge).refresh()
  }

  const catalog = platformModelCatalog()
  await catalog.load()
  const owner = catalog.owner.state.get().owner
  const account = catalog.account.get()

  if (
    !owner ||
    !hasPlatformModelIdentity(account) ||
    account.account.id !== owner.user_id ||
    !platformOwner ||
    !platformOrigin ||
    platformOwner !== owner.user_id ||
    platformOrigin !== owner.platform_origin
  ) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  return { account, owner }
}

function target(owner: SessionOwnerScope, sessionId: string) {
  return {
    connection_id: typeof owner === 'object' && owner ? owner.connectionId : '',
    profile: typeof owner === 'object' && owner ? owner.profile : owner || 'default',
    session_id: sessionId
  }
}

export async function bindSelectedPlatformSession(
  owner: SessionOwnerScope,
  sessionId: string,
  selection: PlatformSessionModel,
  request?: Request,
  requireKnownOwner = false,
  expectedAccount?: PlatformAccountSnapshot,
  purpose: PlatformModelPurpose = 'chat'
): Promise<PlatformModelOwner> {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  if (!hasPlatformModelIdentity(account)) {
    throw new PlatformSelectionError('not_authenticated')
  }

  if (selection.ownerUserId !== account.account.id) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  await catalog.owner.load()
  const authoritativeOwner = catalog.owner.state.get().owner
  const current = catalog.account.get()

  if (
    (expectedAccount !== undefined && !samePlatformAccount(account, expectedAccount)) ||
    current?.revision !== account.revision ||
    current?.mode !== account.mode ||
    current?.account?.id !== account.account.id ||
    !authoritativeOwner ||
    authoritativeOwner.user_id !== selection.ownerUserId ||
    (requireKnownOwner && !selection.platformOrigin) ||
    (selection.platformOrigin !== undefined && selection.platformOrigin !== authoritativeOwner.platform_origin)
  ) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  const result = await bindPlatformModel(
    {
      ...target(owner, sessionId),
      model_id: selection.modelId,
      expected_account_revision: account.revision,
      ...(purpose === 'image' ? { purpose } : {})
    },
    account,
    request
  )

  if (!result.ok) {
    throw new PlatformSelectionError(result.error.code)
  }

  if (!samePlatformAccount(catalog.account.get(), account)) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  return authoritativeOwner
}

export async function createPlatformDraft(
  request: Request,
  params: Record<string, unknown>,
  ownerUserId: string,
  owner: SessionOwnerScope,
  authority: PlatformDraftAuthority | null
): Promise<SessionCreateResponse> {
  if (params.model_source !== 'aino') {
    return createGatewaySession(null, params, request)
  }

  const catalog = platformModelCatalog()
  const modelId = String(params.model_id || '')

  const authorityCurrent = () => {
    const account = catalog.account.get()
    const currentOwner = catalog.owner.state.get().owner

    return Boolean(
      authority &&
      samePlatformAccount(account, authority.account) &&
      currentOwner?.user_id === authority.owner.user_id &&
      currentOwner.platform_origin === authority.owner.platform_origin
    )
  }

  if (!authority || !authorityCurrent() || authority.owner.user_id !== ownerUserId) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  requirePlatformSelection(authority.account, catalog.state.get().models, modelId, ownerUserId)
  // A profile-only socket has no registry route. Its create params still own
  // the native binding target; falling back to default dials another backend.
  const bindingOwner = owner ?? (typeof params.profile === 'string' ? params.profile : 'default')
  const created = await createGatewaySession(null, params, request)

  try {
    if (!authorityCurrent()) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    if (created.info?.model_source !== 'aino' || created.info.model_id !== modelId) {
      throw new PlatformSelectionError('unsupported_gateway')
    }

    const authoritativeOwner = await bindSelectedPlatformSession(
      bindingOwner,
      created.session_id,
      { modelId, ownerUserId, platformOrigin: authority.owner.platform_origin, status: 'awaiting_managed_credentials' },
      request,
      false,
      authority.account
    )

    return {
      ...created,
      info: { ...created.info, model_status: 'ready', platform_owner: authoritativeOwner }
    }
  } catch (error) {
    await request('session.close', { session_id: created.session_id }).catch(() => undefined)
    await clearPlatformSession(bindingOwner, created.session_id)
    throw error
  }
}

export async function clearPlatformSession(
  owner: SessionOwnerScope,
  sessionId: string,
  purpose: PlatformModelPurpose = 'chat'
): Promise<void> {
  await window.hermesDesktop?.platformModels?.clear({
    ...target(owner, sessionId),
    ...(purpose === 'image' ? { purpose } : {})
  })
}

async function conversationSelection(sessionId: string, request: Request): Promise<ConversationModelRow | null> {
  try {
    return (
      await request<{ selection: ConversationModelRow | null }>('model.session', {
        session_id: sessionId,
        action: 'selection'
      })
    ).selection
  } catch (error) {
    if (isMissingRpcMethod(error)) {
      return null
    }

    throw error
  }
}

function validateConfiguredConversationModel(selected: ConversationModelRow, options: ModelOptionsResult) {
  if (selected.model_source !== 'provider') {
    return
  }

  const configured = options.providers.find(row => row.slug === selected.provider && row.authenticated === true)

  if (!configured?.models?.includes(selected.model_id) || configured.unavailable_models?.includes(selected.model_id)) {
    throw new PlatformSelectionError('model_unavailable')
  }
}

function conversationModelMatches(selected: ConversationModelRow, info: ModelOptionsResult['session_info']) {
  return selected.model_source === 'aino'
    ? info?.model_source === 'aino' && info.model_id === selected.model_id
    : info?.provider === selected.provider && info?.model === selected.model_id
}

function publishConversationModel(
  sessionId: string,
  selected: ConversationModelRow,
  managed: PlatformSessionModel | null
) {
  const update = (state: ReturnType<typeof $sessionStates.get>[string]) => ({
    ...state,
    model: selected.model_id,
    provider: selected.model_source === 'aino' ? 'aino' : selected.provider || '',
    platformModel: managed
  })

  const delegate = sessionTileDelegate()

  if (delegate) {
    delegate.updateSession(sessionId, update)
  } else if ($sessionStates.get()[sessionId]) {
    publishSessionState(sessionId, update($sessionStates.get()[sessionId]))
  }
}

/** A terminal-requested pick is desired conversation metadata. Apply it only
 * before the next idle submission, through the same canonical mutation and
 * native credential binding used by the model picker. */
async function prepareConversationSelection(
  owner: SessionOwnerScope,
  sessionId: string,
  request: Request
): Promise<boolean> {
  if (window.hermesDesktop?.accountAdapter !== 'platform') {
    return false
  }

  const selected = await conversationSelection(sessionId, request)

  if (!selected) {
    return false
  }

  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  const assertAccount = () => {
    if (catalog.account.get() !== account && !samePlatformAccount(account, catalog.account.get())) {
      throw new PlatformSelectionError('platform_account_changed')
    }
  }

  if (selected.model_source === 'aino') {
    if (!selected.owner || selected.owner.user_id !== account?.account?.id) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    await catalog.load()
    assertAccount()
    requirePlatformSelection(account, catalog.state.get().models, selected.model_id, selected.owner.user_id)
  }

  const options = await request<ModelOptionsResult>('model.options', {
    session_id: sessionId,
    explicit_only: true,
    include_session_info: true
  })

  assertAccount()

  validateConfiguredConversationModel(selected, options)

  if (!conversationModelMatches(selected, options.session_info)) {
    const result = await request<{ deferred?: boolean; confirm_required?: boolean; status?: string }>('session.model', {
      session_id: sessionId,
      payload: {
        model: selected.model_id,
        ...(selected.model_source === 'aino' ? { model_source: 'aino' } : { provider: selected.provider })
      }
    })

    assertAccount()

    if (result.deferred || result.confirm_required || result.status === 'confirmation_required') {
      throw new PlatformSelectionError('model_unavailable')
    }
  }

  const managed: PlatformSessionModel | null =
    selected.model_source === 'aino'
      ? {
          modelId: selected.model_id,
          ownerUserId: selected.owner!.user_id,
          platformOrigin: selected.owner!.platform_origin,
          status: 'ready'
        }
      : null

  if (managed) {
    await bindSelectedPlatformSession(owner, sessionId, managed, request, true, account ?? undefined)
  } else {
    await clearPlatformSession(owner, sessionId)
  }

  assertAccount()

  publishConversationModel(sessionId, selected, managed)

  return true
}

async function requireConfiguredSessionModel(
  owner: SessionOwnerScope,
  state: ReturnType<typeof $sessionStates.get>[string] | undefined
): Promise<void> {
  const catalog = platformModelCatalog()

  if (
    !state ||
    state.provider === 'aino' ||
    state.platformModel ||
    window.hermesDesktop?.accountAdapter !== 'platform' ||
    !hasPlatformModelIdentity(catalog.account.get())
  ) {
    return
  }

  if (!state.model && !state.provider) {
    throw new PlatformSelectionError('model_unavailable')
  }

  if (!state.storedSessionId || !$botChatSessionIds.get().has(state.storedSessionId)) {
    return
  }

  const account = catalog.account.get()
  const scope = profileScopeForSessionOwner(owner)

  if (!scope) {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  const profile = typeof scope === 'string' ? scope : scope.profile || 'default'
  const connectionId = typeof scope === 'object' ? (scope.connectionId ?? undefined) : undefined
  const row = (await getSession(state.storedSessionId, scope)) as CanonicalModelRow

  if (!samePlatformAccount(account, catalog.account.get())) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  if (!unselectedCanonicalModelRow(row, state.storedSessionId, { connectionId, profile })) {
    return
  }

  const configured = await getGlobalModelInfo(scope)

  if (!samePlatformAccount(account, catalog.account.get())) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  if (!configured.model && !configured.provider) {
    throw new PlatformSelectionError('model_unavailable')
  }
}

export async function preparePlatformSessionRequest(
  owner: SessionOwnerScope,
  method: string,
  params: Record<string, unknown>,
  request: Request
): Promise<void> {
  if (!['prompt.submit', 'session.summary'].includes(method) || typeof params.session_id !== 'string') {
    return
  }

  const prepared = await prepareConversationSelection(owner, params.session_id, request)
  const state = $sessionStates.get()[params.session_id]

  if (!prepared) {
    await requireConfiguredSessionModel(owner, state)
  }

  if (!prepared && state?.provider === 'aino') {
    if (!state.platformModel) {
      throw new PlatformSelectionError('model_unavailable')
    }

    await bindSelectedPlatformSession(owner, params.session_id, state.platformModel, request, true)
  }

  if (method === 'prompt.submit') {
    const { preparePlatformImageSession } = await import('./platform-image-session-binding')
    await preparePlatformImageSession(owner, params.session_id, request)
  }
}
