import type { ModelOptionsResult } from '@hermes/shared'

import { getSession } from '@/api/sessions'
import { translateNow } from '@/i18n/runtime'
import { resolveModelDefault } from '@/lib/model-default'
import { modelOptionsQueryKey } from '@/lib/model-options'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { queryClient } from '@/lib/query-client'
import { switchSessionModel } from '@/lib/session-model-switch'
import { retainGatewayForAgent } from '@/store/gateway'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, readPlatformDefault } from '@/store/platform-models'
import { $activeSessionId, $selectedStoredSessionId, getSessionOwnerHint } from '@/store/session'
import { requestForSessionProfile } from '@/store/session-request-router'
import { $sessionStates, $sessionTiles } from '@/store/session-states'
import type { SessionInfo, SessionRuntimeInfo } from '@/types/hermes'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'

import type { PluginProfileRoute } from './profile-request'

interface EmptyBotModelOptions {
  storedSessionId: string
  route: PluginProfileRoute
  isCurrent: () => boolean
}

type PersistedBotSession = Omit<SessionInfo, 'hidden'> & {
  hidden?: boolean | number
  model_config?: unknown
}

/** Exact-id REST returns the complete stored row. Missing/malformed evidence
 * never means "empty": legacy or partially loaded sessions stay untouched. */
function emptyCanonical(row: PersistedBotSession, storedId: string, route: PluginProfileRoute): boolean {
  if (
    row.id !== storedId || row.profile !== route.targetProfile ||
    (row.connection_id && row.connection_id !== route.connectionId) ||
    row.title !== 'Bot Chat' || (row.hidden !== true && row.hidden !== 1) ||
    row.message_count !== 0 || row.model === undefined || row.model || row.parent_session_id || row.archived ||
    !Object.hasOwn(row, 'model_config')
  ) { return false }

  let config = row.model_config

  if (typeof config === 'string') {
    try { config = JSON.parse(config) } catch { return false }
  }

  if (config === null) { return true }

  if (!config || typeof config !== 'object' || Array.isArray(config)) { return false }

  return Object.entries(config).every(([key, value]) =>
    (key === 'follow_profile_config' || key === 'yolo_mode') && typeof value === 'boolean'
  )
}

function boundRuntimeId(storedId: string, expected: PluginProfileRoute): string | null {
  const primary = $selectedStoredSessionId.get() === storedId
  const tile = primary ? undefined : $sessionTiles.get().find(candidate => candidate.storedSessionId === storedId)
  const owner = primary ? getSessionOwnerHint(storedId, expected) : tile?.ownerRoute

  if (
    !owner || owner.connectionId !== expected.connectionId || owner.profile !== expected.profile ||
    (owner.targetProfile ?? owner.profile) !== expected.targetProfile
  ) { return null }

  return primary ? $activeSessionId.get() : tile?.runtimeId ?? null
}

/** Restore only a never-used canonical chat after its own saved default was
 * configured. This authorizes an existing runtime; it never creates a chat or
 * submits a prompt, and does not migrate or overwrite any historical choice. */
export async function restoreEmptyBotModelDefault({
  storedSessionId, route, isCurrent
}: EmptyBotModelOptions): Promise<boolean> {
  if (window.hermesDesktop?.accountAdapter !== 'platform' || !isCurrent()) { return false }

  const capturedRoute = { ...route }

  if (!capturedRoute.connectionId || !capturedRoute.profile || !capturedRoute.targetProfile) { return false }
  const runtimeId = boundRuntimeId(storedSessionId, capturedRoute)

  if (!runtimeId) { return false }

  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  if (!hasPlatformModelIdentity(account)) { return false }

  const emptyRuntime = () => {
    const state = $sessionStates.get()[runtimeId]

    return isCurrent() && boundRuntimeId(storedSessionId, capturedRoute) === runtimeId &&
      samePlatformAccount(catalog.account.get(), account) &&
      state?.storedSessionId === storedSessionId && state.messages.length === 0 &&
      !state.busy && !state.awaitingResponse && !state.turnLive &&
      !state.model && !state.provider && !state.platformModel
  }

  if (!emptyRuntime()) { return false }
  const scope = platformDefaultScope({ connectionId: capturedRoute.connectionId, profile: capturedRoute.targetProfile })
  await catalog.owner.load()

  if (!emptyRuntime()) { return false }
  const owner = catalog.owner.state.get().owner

  if (!owner || owner.user_id !== account.account.id) { return false }
  const preferred = readPlatformDefault(account.account.id, scope, account.mode, owner.platform_origin)

  // An API fallback or another workspace's selection is not this Bot's choice.
  if (!preferred) { return false }

  const preferenceUnchanged = () =>
    catalog.owner.state.get().owner?.user_id === owner.user_id &&
    catalog.owner.state.get().owner?.platform_origin === owner.platform_origin &&
    readPlatformDefault(account.account.id, scope, account.mode, owner.platform_origin) === preferred

  const row = await getSession(storedSessionId, scope.route) as PersistedBotSession

  if (!emptyRuntime() || !emptyCanonical(row, storedSessionId, capturedRoute)) { return false }

  const release = await retainGatewayForAgent(capturedRoute.connectionId, capturedRoute.profile)

  try {
    if (!emptyRuntime() || !preferenceUnchanged()) { return false }
    const resolved = await resolveModelDefault(scope.route, capturedRoute)

    if (!emptyRuntime() || !preferenceUnchanged() || resolved.platform?.modelId !== preferred) { return false }

    const request = <T,>(method: string, params?: Record<string, unknown>): Promise<T> =>
      requestForSessionProfile<T>(capturedRoute, () => Promise.reject(new Error('Bot owner route required')), method, params)

    const options = await request<ModelOptionsResult & { session_info?: SessionRuntimeInfo }>('model.options', {
      session_id: runtimeId, profile: capturedRoute.targetProfile, include_session_info: true, explicit_only: true
    })

    const info = options.session_info

    if (
      !emptyRuntime() || !preferenceUnchanged() || !info ||
      info.model === undefined || info.provider === undefined ||
      info.model || info.provider || info.model_id || info.model_source || info.running
    ) { return false }

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
