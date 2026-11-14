import type { ModelOptionsResult } from '@hermes/shared'

import { getSession } from '@/api/sessions'
import { getGlobalModelInfo } from '@/hermes'
import { translateNow } from '@/i18n/runtime'
import { resolveModelDefault } from '@/lib/model-default'
import { modelOptionsQueryKey } from '@/lib/model-options'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { isUnselectedSessionModel, unselectedCanonicalModelRow } from '@/lib/platform-session-model'
import { queryClient } from '@/lib/query-client'
import { switchSessionModel } from '@/lib/session-model-switch'
import { retainGatewayForAgent } from '@/store/gateway'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, readPlatformDefault } from '@/store/platform-models'
import {
  $activeSessionId,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $selectedStoredSessionId,
  getSessionOwnerHint,
  setCurrentModelTransient,
  setCurrentProviderTransient
} from '@/store/session'
import { requestForSessionProfile } from '@/store/session-request-router'
import { $sessionStates, $sessionTiles, publishSessionState, sessionTileDelegate } from '@/store/session-states'
import type { SessionInfo, SessionRuntimeInfo } from '@/types/hermes'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'

import type { PluginProfileRoute } from './profile-request'

interface EmptyBotModelOptions {
  storedSessionId: string
  route: PluginProfileRoute
  isCurrent: () => boolean
}

interface CanonicalFallbackEvidence {
  model: string
  provider: string
}

type PersistedBotSession = Omit<SessionInfo, 'hidden'> & {
  hidden?: boolean | number
  model_config?: unknown
}

/** Exact-id REST returns the complete stored row. Missing/malformed evidence
 * never means "empty": legacy or partially loaded sessions stay untouched. */
function emptyCanonical(row: PersistedBotSession, storedId: string, route: PluginProfileRoute): boolean {
  if (
    row.id !== storedId ||
    row.profile !== route.targetProfile ||
    (row.connection_id && row.connection_id !== route.connectionId) ||
    row.title !== 'Bot Chat' ||
    (row.hidden !== true && row.hidden !== 1) ||
    row.message_count !== 0 ||
    row.model === undefined ||
    row.model ||
    row.parent_session_id ||
    row.archived ||
    !Object.hasOwn(row, 'model_config')
  ) {
    return false
  }

  let config = row.model_config

  if (typeof config === 'string') {
    try {
      config = JSON.parse(config)
    } catch {
      return false
    }
  }

  if (config === null) {
    return true
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false
  }

  return Object.entries(config).every(
    ([key, value]) => (key === 'follow_profile_config' || key === 'yolo_mode') && typeof value === 'boolean'
  )
}

function restorableCanonical(
  row: PersistedBotSession,
  storedId: string,
  route: PluginProfileRoute,
  normalized: CanonicalFallbackEvidence | null
): boolean {
  return emptyCanonical(normalized ? { ...row, model: '' } : row, storedId, route)
}

function boundRuntimeId(storedId: string, expected: PluginProfileRoute): string | null {
  const primary = $selectedStoredSessionId.get() === storedId
  const tile = primary ? undefined : $sessionTiles.get().find(candidate => candidate.storedSessionId === storedId)
  const owner = primary ? getSessionOwnerHint(storedId, expected) : tile?.ownerRoute

  if (
    !owner ||
    owner.connectionId !== expected.connectionId ||
    owner.profile !== expected.profile ||
    (owner.targetProfile ?? owner.profile) !== expected.targetProfile
  ) {
    return null
  }

  return primary ? $activeSessionId.get() : (tile?.runtimeId ?? null)
}

function emptyRuntimeSnapshot(runtimeId: string, storedSessionId: string): boolean {
  const state = $sessionStates.get()[runtimeId]

  return Boolean(
    state?.storedSessionId === storedSessionId &&
    state.messages.length === 0 &&
    !state.busy &&
    !state.awaitingResponse &&
    !state.turnLive &&
    !state.model &&
    !state.provider &&
    !state.platformModel
  )
}

function emptyRuntimeModel(info: SessionRuntimeInfo | undefined): boolean {
  return isUnselectedSessionModel(info)
}

async function restorableRuntimeModel(
  info: SessionRuntimeInfo | undefined,
  normalized: CanonicalFallbackEvidence | null,
  { storedSessionId, route, isCurrent }: EmptyBotModelOptions
): Promise<boolean> {
  if (emptyRuntimeModel(info)) {
    return true
  }

  if (
    !normalized ||
    !info ||
    info.model_source ||
    info.model_id ||
    info.running ||
    (info.model || '') !== normalized.model ||
    (info.provider || '') !== normalized.provider
  ) {
    return false
  }

  // Clearing the display does not stop an ambient native agent. Recheck the
  // durable row before replacing that route so a new user pin always wins.
  const row = (await getSession(storedSessionId, {
    connectionId: route.connectionId,
    profile: route.targetProfile
  })) as PersistedBotSession

  return (
    isCurrent() &&
    unselectedCanonicalModelRow(row, storedSessionId, {
      connectionId: route.connectionId,
      profile: route.targetProfile
    })
  )
}

/** Native lazy resumes may report Hermes' silent model even though the owning
 * profile and canonical row contain no user choice. Confirm via the picker read. */
async function normalizeCanonicalFallback(
  options: EmptyBotModelOptions,
  runtimeId: string
): Promise<CanonicalFallbackEvidence | null> {
  const { route, storedSessionId, isCurrent } = options
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const initialModel = $sessionStates.get()[runtimeId]?.model
  const initialProvider = $sessionStates.get()[runtimeId]?.provider

  const current = () => {
    const state = $sessionStates.get()[runtimeId]

    return (
      isCurrent() &&
      boundRuntimeId(storedSessionId, route) === runtimeId &&
      samePlatformAccount(catalog.account.get(), account) &&
      state?.storedSessionId === storedSessionId &&
      state.model === initialModel &&
      state.provider === initialProvider &&
      !state.platformModel &&
      state.messages.length === 0 &&
      !state.busy &&
      !state.awaitingResponse &&
      !state.turnLive
    )
  }

  if (!initialModel || initialProvider === 'aino' || !current()) {
    return null
  }

  const scope = platformDefaultScope({ connectionId: route.connectionId, profile: route.targetProfile })
  const row = (await getSession(storedSessionId, scope.route)) as PersistedBotSession

  if (
    !current() ||
    row.model !== initialModel ||
    !unselectedCanonicalModelRow(row, storedSessionId, {
      connectionId: route.connectionId,
      profile: route.targetProfile
    })
  ) {
    return null
  }

  const configured = await getGlobalModelInfo(scope.route)

  if (!current() || configured.model || configured.provider) {
    return null
  }

  const snapshot = await requestForSessionProfile<ModelOptionsResult>(
    route,
    () => Promise.reject(new Error('Bot owner route required')),
    'model.options',
    {
      session_id: runtimeId,
      profile: route.targetProfile,
      explicit_only: true,
      include_session_info: true
    }
  )

  if (
    !current() ||
    !snapshot.session_info ||
    snapshot.session_info.model_source ||
    snapshot.session_info.model_id ||
    snapshot.session_info.running
  ) {
    return null
  }

  const update = (state: ReturnType<typeof $sessionStates.get>[string]) => ({
    ...state,
    model: '',
    provider: '',
    platformModel: null
  })

  const delegate = sessionTileDelegate()

  if (delegate) {
    delegate.updateSession(runtimeId, update)
  } else {
    publishSessionState(runtimeId, update($sessionStates.get()[runtimeId]))
  }

  if ($activeSessionId.get() === runtimeId && $selectedStoredSessionId.get() === storedSessionId) {
    setCurrentModelTransient('')
    setCurrentProviderTransient('')
    $currentPlatformOwner.set('')
    $currentPlatformOrigin.set('')
  }

  queryClient.setQueryData(modelOptionsQueryKey(route.targetProfile, runtimeId, route.connectionId), {
    ...snapshot,
    model: '',
    provider: ''
  })

  return { model: snapshot.session_info.model || '', provider: snapshot.session_info.provider || '' }
}

function preferredDefaultUnchanged(
  catalog: ReturnType<typeof platformModelCatalog>,
  owner: { user_id: string; platform_origin: string },
  userId: string,
  scope: ReturnType<typeof platformDefaultScope>,
  mode: string,
  preferred: string
): boolean {
  const current = catalog.owner.state.get().owner

  return (
    current?.user_id === owner.user_id &&
    current?.platform_origin === owner.platform_origin &&
    readPlatformDefault(userId, scope, mode, owner.platform_origin) === preferred
  )
}

/** Restore only a never-used canonical chat after its own saved default was
 * configured. This authorizes an existing runtime; it never creates a chat or
 * submits a prompt, and does not migrate or overwrite any historical choice. */
export async function restoreEmptyBotModelDefault({
  storedSessionId,
  route,
  isCurrent
}: EmptyBotModelOptions): Promise<boolean> {
  if (window.hermesDesktop?.accountAdapter !== 'platform' || !isCurrent()) {
    return false
  }

  const capturedRoute = { ...route }

  if (!capturedRoute.connectionId || !capturedRoute.profile || !capturedRoute.targetProfile) {
    return false
  }

  const runtimeId = boundRuntimeId(storedSessionId, capturedRoute)

  if (!runtimeId) {
    return false
  }

  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  if (!hasPlatformModelIdentity(account)) {
    return false
  }

  const normalized = await normalizeCanonicalFallback({ storedSessionId, route: capturedRoute, isCurrent }, runtimeId)

  const emptyRuntime = () =>
    isCurrent() &&
    boundRuntimeId(storedSessionId, capturedRoute) === runtimeId &&
    samePlatformAccount(catalog.account.get(), account) &&
    emptyRuntimeSnapshot(runtimeId, storedSessionId)

  if (!emptyRuntime()) {
    return false
  }

  const scope = platformDefaultScope({ connectionId: capturedRoute.connectionId, profile: capturedRoute.targetProfile })
  await catalog.owner.load()

  if (!emptyRuntime()) {
    return false
  }

  const owner = catalog.owner.state.get().owner

  if (!owner || owner.user_id !== account.account.id) {
    return false
  }

  const preferred = readPlatformDefault(account.account.id, scope, account.mode, owner.platform_origin)

  // An API fallback or another workspace's selection is not this Bot's choice.
  if (!preferred) {
    return false
  }

  const preferenceUnchanged = () =>
    preferredDefaultUnchanged(catalog, owner, account.account.id, scope, account.mode, preferred)

  const canRestore = () => emptyRuntime() && preferenceUnchanged()
  const row = (await getSession(storedSessionId, scope.route)) as PersistedBotSession

  if (!emptyRuntime() || !restorableCanonical(row, storedSessionId, capturedRoute, normalized)) {
    return false
  }

  const release = await retainGatewayForAgent(capturedRoute.connectionId, capturedRoute.profile)

  try {
    if (!canRestore()) {
      return false
    }

    const resolved = await resolveModelDefault(scope.route, capturedRoute)

    if (!canRestore() || resolved.platform?.modelId !== preferred) {
      return false
    }

    const request = <T>(method: string, params?: Record<string, unknown>): Promise<T> =>
      requestForSessionProfile<T>(
        capturedRoute,
        () => Promise.reject(new Error('Bot owner route required')),
        method,
        params
      )

    const options = await request<ModelOptionsResult & { session_info?: SessionRuntimeInfo }>('model.options', {
      session_id: runtimeId,
      profile: capturedRoute.targetProfile,
      include_session_info: true,
      explicit_only: true
    })

    const info = options.session_info

    if (
      !canRestore() ||
      !(await restorableRuntimeModel(info, normalized, {
        storedSessionId,
        route: capturedRoute,
        isCurrent: canRestore
      }))
    ) {
      return false
    }

    return await switchSessionModel({
      selection: { sessionId: runtimeId, model: preferred, provider: 'aino' },
      connectionId: capturedRoute.connectionId,
      profile: capturedRoute.profile,
      queryClient,
      request,
      cache: (_sessionId, provider, model) => {
        queryClient.setQueryData<ModelOptionsResult>(
          modelOptionsQueryKey(capturedRoute.targetProfile, runtimeId, capturedRoute.connectionId),
          previous => ({ ...previous, provider, model, providers: previous?.providers ?? [] })
        )
      },
      copy: {
        confirm: translateNow('common.confirm'),
        failed: translateNow('desktop.modelSwitchFailed'),
        busy: translateNow('platformModels.switchBusy'),
        recovery: translateNow('platformModels.switchRecovery'),
        retry: translateNow('platformModels.retry')
      }
    })
  } finally {
    release()
  }
}
