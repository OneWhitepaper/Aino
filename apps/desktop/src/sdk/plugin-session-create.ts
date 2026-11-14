import { capturePlatformDraftAuthority, createPlatformDraft } from '@/api/platform-session-binding'
import { platformModelSupportsPurpose } from '@/lib/platform-model-purpose'
import { RECONNECT_ATTEMPT_TIMEOUT_MS } from '@/lib/with-timeout'
import { $gateway, requestGatewayForAgent, retainGatewayForAgent, type SpawnPriority } from '@/store/gateway'
import {
  $gatewayManagedCapabilities,
  type ManagedModelRoute,
  managedModelRouteCapability
} from '@/store/gateway-managed-capability'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { $connection } from '@/store/session'
import type { SessionRuntimeInfo } from '@/types/hermes'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'

import { preparePluginGroupModels } from './plugin-group-models'
import { requestPluginImageGeneration } from './plugin-image-generation'
import { resolvePluginBotDefault } from './plugin-model-default'
import { requestPluginProfileCreate } from './plugin-profile-create'

export interface PluginSessionCreateRoute {
  connectionId: null | string
  profile: string
  targetProfile: string
}

type Request = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>

function usesPluginPlatformDefault(method: string, params: Record<string, unknown>): boolean {
  if (
    window.hermesDesktop?.accountAdapter !== 'platform' ||
    !hasPlatformModelIdentity(platformModelCatalog().account.get())
  ) {
    return false
  }

  return method === 'setup.runtime_check'
    ? !params.provider
    : method === 'session.create' &&
        params.follow_profile_config === true &&
        !['model', 'provider', 'model_source', 'model_id'].some(key => Boolean(params[key]))
}

function isCanonicalBotParams(params: Record<string, unknown>): boolean {
  return params.title === 'Bot Chat' && params.hidden === true && params.follow_profile_config === true
}

function normalizeCanonicalSelection<T extends { session_id?: string; info?: SessionRuntimeInfo }>(created: T): T {
  // The resolver proved that this account/profile has no selection. An
  // ambient route chosen by native prewarm cannot turn that into consent.
  return {
    ...created,
    info: {
      ...(created.info || {}),
      model: '',
      provider: '',
      model_source: undefined,
      model_id: undefined,
      model_status: undefined
    }
  }
}

async function resolvePluginActiveRoute(route: PluginSessionCreateRoute): Promise<PluginSessionCreateRoute> {
  const getProfileRoutes = window.hermesDesktop?.getProfileRoutes

  if (!getProfileRoutes || !route.connectionId) {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  const routes = await getProfileRoutes([route.profile, route.targetProfile])
  const sourceRoutes = routes.filter(candidate => candidate.connectionId === route.connectionId)
  const active = sourceRoutes.find(
    candidate => candidate.profile === route.profile && candidate.targetProfile === route.targetProfile
  )

  if (active) {
    return { ...active }
  }

  const target = sourceRoutes.filter(
    candidate => candidate.profile === route.targetProfile && candidate.targetProfile === route.targetProfile
  )

  if (target.length !== 1) {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  return { ...target[0] }
}

function pluginAccountFence(): () => void {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  return () => {
    if (catalog.account.get() !== account && !samePlatformAccount(catalog.account.get(), account)) {
      throw new PlatformSelectionError('platform_account_changed')
    }
  }
}

/** Socket open precedes gateway.ready. An unknown capability is still a handshake,
 * not evidence that an Aino account needs a third-party provider key. */
function waitForManagedCapability(route: ManagedModelRoute): Promise<void> {
  const current = managedModelRouteCapability(route)

  if (current !== 'unknown') {
    return current === 'supported'
      ? Promise.resolve()
      : Promise.reject(new PlatformSelectionError('unsupported_gateway'))
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer)
      unlisten()

      if (managedModelRouteCapability(route) === 'supported') {
        resolve()
      } else {
        reject(new PlatformSelectionError('unsupported_gateway'))
      }
    }

    const timer = setTimeout(finish, RECONNECT_ATTEMPT_TIMEOUT_MS)

    const unlisten = $gatewayManagedCapabilities.listen(() => {
      if (managedModelRouteCapability(route) !== 'unknown') {
        finish()
      }
    })
  })
}

async function resolvePluginModelDefault(route: PluginSessionCreateRoute, profile: string, assertAccount: () => void) {
  const scope = { ...(route.connectionId ? { connectionId: route.connectionId } : {}), profile }
  const managedRoute = { connectionId: route.connectionId ?? undefined, profile: route.profile }
  const resolved = await resolvePluginBotDefault(scope, managedRoute, assertAccount)
  assertAccount()

  // Explicit third-party configuration does not depend on managed capability.
  if (resolved.model || resolved.provider) {
    return resolved
  }

  await waitForManagedCapability(managedRoute)
  assertAccount()
  const ready = await resolvePluginBotDefault(scope, managedRoute, assertAccount)
  assertAccount()

  if (!ready.model && !ready.provider) {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  return ready
}

/** Opening an empty Bot is navigation, not permission to guess its first model. */
async function resolveCanonicalChatDefault(
  route: PluginSessionCreateRoute,
  params: Record<string, unknown>,
  assertAccount: () => void
) {
  try {
    return await resolvePluginModelDefault(route, route.targetProfile, assertAccount)
  } catch (error) {
    assertAccount()
    const catalog = platformModelCatalog()
    const state = catalog.state.get()

    const selectable =
      state.phase === 'ready' &&
      state.models.some(model => model.state === 'available' && platformModelSupportsPurpose(model, 'chat'))

    if (
      error instanceof PlatformSelectionError &&
      error.code === 'model_unavailable' &&
      isCanonicalBotParams(params) &&
      selectable &&
      managedModelRouteCapability({ connectionId: route.connectionId ?? undefined, profile: route.profile }) ===
        'supported'
    ) {
      return { model: '', provider: '', platform: null }
    }

    throw error
  }
}

async function requestPluginRuntimeReadiness<T>(
  route: PluginSessionCreateRoute,
  request: Request,
  params: Record<string, unknown>,
  timeoutMs?: number,
  spawnPriority?: SpawnPriority
): Promise<T> {
  const assertAccount = pluginAccountFence()
  const targetProfile =
    typeof params.profile === 'string' && params.profile.trim() ? params.profile.trim() : route.targetProfile
  const release = await retainGatewayForAgent(route.connectionId, route.profile, { spawnPriority })

  try {
    assertAccount()

    const resolved = await resolvePluginModelDefault(route, targetProfile, assertAccount)

    assertAccount()

    if (resolved.platform) {
      return { ok: true, provider: 'aino', model: resolved.platform.modelId } as T
    }

    return await (timeoutMs === undefined
      ? request<T>('setup.runtime_check', params)
      : request<T>('setup.runtime_check', params, timeoutMs))
  } catch (error) {
    if (!(error instanceof PlatformSelectionError)) {
      throw error
    }

    return { ok: false, provider: 'aino', error: error.message, error_code: error.code } as T
  } finally {
    release()
  }
}

function groupSendNotDispatched(error: unknown): Error {
  const data = (error as { data?: Record<string, unknown> } | null)?.data

  // Errors can be frozen or shared with another request. Preserve their public
  // fields without mutating them; this proof concerns only this Send attempt.
  return Object.assign(new Error(error instanceof Error ? error.message : String(error), { cause: error }), error, {
    data: {
      ...data,
      admitted: false,
      ...(error instanceof PlatformSelectionError ? { preparation_message: error.message } : {})
    }
  })
}

async function requestPreparedPluginGroup<T>(
  route: PluginSessionCreateRoute,
  request: Request,
  method: string,
  params: Record<string, unknown>,
  send: () => Promise<T>,
  spawnPriority?: SpawnPriority
): Promise<T> {
  let release: (() => void) | undefined
  let dispatched = false

  try {
    const assertAccount = pluginAccountFence()
    release = await retainGatewayForAgent(route.connectionId, route.profile, { spawnPriority })
    assertAccount()
    await preparePluginGroupModels(
      route,
      request,
      params.room_id as string,
      profile => resolvePluginModelDefault(route, profile, assertAccount),
      assertAccount,
      method === 'groups.retry' ? (params.member_id as string) : undefined
    )
    assertAccount()
    // From this point even a synchronous transport error may have posted the
    // intent. Only the gateway can prove otherwise; preserve its exact error.
    dispatched = true

    return await send()
  } catch (error) {
    throw method === 'groups.send' && !dispatched ? groupSendNotDispatched(error) : error
  } finally {
    // Lease cleanup must not replace a receipt or its admission evidence.
    try {
      release?.()
    } catch (error) {
      console.warn('[plugin-session-create] group lease release failed', error)
    }
  }
}

/** The compatibility door still pins the socket and owner before its first await. */
export async function requestPluginActiveGateway<T>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number
): Promise<T> {
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Aino gateway unavailable')
  }

  const connection = $connection.get()

  const profile = normalizeProfileKey($activeGatewayProfile.get())

  const targetProfile = typeof params.profile === 'string' && params.profile.trim() ? params.profile.trim() : profile

  let route: PluginSessionCreateRoute = {
    connectionId: connection?.connectionId || (connection?.mode === 'local' ? 'local' : null),
    profile,
    targetProfile
  }

  let request: Request = (requestMethod, payload, deadline) =>
    deadline === undefined ? gateway.request(requestMethod, payload) : gateway.request(requestMethod, payload, deadline)

  if (targetProfile !== profile && usesPluginPlatformDefault(method, params)) {
    const assertAccount = pluginAccountFence()
    route = await resolvePluginActiveRoute(route)
    assertAccount()

    if (route.profile !== profile) {
      const captured = route
      request = (requestMethod, payload = {}, deadline) =>
        deadline === undefined
          ? requestGatewayForAgent(captured.connectionId, captured.profile, requestMethod, payload)
          : requestGatewayForAgent(captured.connectionId, captured.profile, requestMethod, payload, deadline)
    }
  }

  return requestPluginSession<T>(route, request, method, params, timeoutMs)
}

/** Bot Chats follow their own profile, with Aino's account default when that profile is empty. */
export async function requestPluginSession<T>(
  route: PluginSessionCreateRoute,
  request: Request,
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
  spawnPriority?: SpawnPriority
): Promise<T> {
  const send = () => (timeoutMs === undefined ? request<T>(method, params) : request<T>(method, params, timeoutMs))

  if (method === 'image.generate') {
    return requestPluginImageGeneration<T>(route, request, params, timeoutMs)
  }

  if (method === 'profiles.create') {
    return requestPluginProfileCreate(route, params, send)
  }

  if (
    (method === 'groups.send' || (method === 'groups.retry' && typeof params.member_id === 'string')) &&
    typeof params.room_id === 'string' &&
    params.room_id &&
    window.hermesDesktop?.accountAdapter === 'platform'
  ) {
    return requestPreparedPluginGroup(route, request, method, params, send, spawnPriority)
  }

  if (!usesPluginPlatformDefault(method, params)) {
    return send()
  }

  if (method === 'setup.runtime_check') {
    return requestPluginRuntimeReadiness<T>(route, request, params, timeoutMs, spawnPriority)
  }

  const capturedParams = { ...params }
  const assertAccount = pluginAccountFence()
  const release = await retainGatewayForAgent(route.connectionId, route.profile, { spawnPriority })

  try {
    assertAccount()
    const resolved = await resolveCanonicalChatDefault(route, capturedParams, assertAccount)
    assertAccount()

    if (!resolved.platform) {
      if (resolved.model || resolved.provider) {
        return await send()
      }

      const created = await send()
      assertAccount()

      return normalizeCanonicalSelection(created as T & { session_id?: string; info?: SessionRuntimeInfo })
    }

    const authority = await capturePlatformDraftAuthority(
      resolved.platform.ownerUserId,
      resolved.platform.platformOrigin
    )
    assertAccount()
    const owner = route.connectionId ? { connectionId: route.connectionId, profile: route.profile } : route.profile

    const createRequest: Request = (requestMethod, payload, requestTimeout) =>
      requestMethod === 'session.create' && timeoutMs !== undefined
        ? request(requestMethod, payload, timeoutMs)
        : requestTimeout === undefined
          ? request(requestMethod, payload)
          : request(requestMethod, payload, requestTimeout)

    return (await createPlatformDraft(
      createRequest,
      { ...capturedParams, profile: route.targetProfile, model_source: 'aino', model_id: resolved.platform.modelId },
      resolved.platform.ownerUserId,
      owner,
      authority
    )) as T
  } finally {
    release()
  }
}
