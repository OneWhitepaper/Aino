import { getHermesConfigRecord } from '@/api/config'
import { preparePlatformImageSession } from '@/api/platform-image-session-binding'
import { clearPlatformSession } from '@/api/platform-session-binding'
import { deleteSession } from '@/api/sessions'
import { retainGatewayForAgent } from '@/store/gateway'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'

import type { PluginSessionCreateRoute } from './plugin-session-create'

type Request = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>

/** Avatar generation has no chat turn to carry the device's image authority. Borrow
 * the existing hidden-session binding, then discard only that helper conversation. */
export async function requestPluginImageGeneration<T>(
  route: PluginSessionCreateRoute,
  request: Request,
  params: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  const send = () => timeoutMs === undefined ? request<T>('image.generate', params) : request<T>('image.generate', params, timeoutMs)

  if (params.probe || params.session_id) { return send() }
  const catalog = platformModelCatalog()
  const account = catalog.account.get()

  const assertAccount = () => {
    const current = catalog.account.get()

    if (current !== account && !samePlatformAccount(current, account)) { throw new PlatformSelectionError('platform_account_changed') }
  }

  const scope = { ...(route.connectionId ? { connectionId: route.connectionId } : {}), profile: route.targetProfile }
  const config = await getHermesConfigRecord(scope, { includeDefaults: false })
  assertAccount()
  const rawImage = config.image_gen
  const image = rawImage && typeof rawImage === 'object' && !Array.isArray(rawImage) ? rawImage as Record<string, unknown> : null

  if (image?.provider !== 'aino') { return send() }

  const owner = route.connectionId ? { ...route, connectionId: route.connectionId } : route.profile

  const requestImageOwner: Request = (method, payload = {}, deadline) => {
    const scoped = { ...payload, profile: route.targetProfile }

    return deadline === undefined ? request(method, scoped) : request(method, scoped, deadline)
  }

  const release = await retainGatewayForAgent(route.connectionId, route.profile, { spawnPriority: 'foreground' })
  let created: { session_id: string; stored_session_id?: string } | undefined

  try {
    assertAccount()
    // A following GUI session may precede text-model setup. Avatar generation
    // needs only its separately configured image route; it never submits a turn.
    created = await request<{ session_id: string; stored_session_id?: string }>('session.create', { source: 'desktop', hidden: true, follow_profile_config: true, profile: route.targetProfile })
    assertAccount()
    await preparePlatformImageSession(owner, created.session_id, requestImageOwner, true)
    assertAccount()
    const result = await request<T>('image.generate', { ...params, session_id: created.session_id, profile: route.targetProfile }, timeoutMs)
    assertAccount()

    return result
  } finally {
    if (created) {
      await clearPlatformSession(owner, created.session_id, 'image').catch(() => undefined)
      await deleteSession(created.stored_session_id || created.session_id, scope).catch(() => undefined)
    }

    release()
  }
}
