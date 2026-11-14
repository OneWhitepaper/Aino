import { translateNow } from '@/i18n'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { notify } from '@/store/notifications'
import { platformModelCatalog, PlatformSelectionError, requirePlatformSelection } from '@/store/platform-models'
import { requestRoute } from '@/store/recovery-requests'
import { profileScopeForSessionOwner, type SessionOwnerScope } from '@/store/session-request-router'

import { getHermesConfigRecord } from './config'
import { bindSelectedPlatformSession } from './platform-session-binding'

type Request = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>

/** Image readiness is independent of chat billing and cannot block a normal text turn. */
export async function preparePlatformImageSession(
  owner: SessionOwnerScope,
  sessionId: string,
  request: Request,
  required = false
): Promise<void> {
  const captured = platformDefaultScope(profileScopeForSessionOwner(owner))

  const bindingOwner =
    owner ??
    (captured.route.connectionId
      ? { connectionId: captured.route.connectionId, profile: captured.route.profile }
      : captured.route.profile)

  try {
    const config = await getHermesConfigRecord(captured.route, { includeDefaults: false })
    const agent = config.agent

    const disabled =
      agent && typeof agent === 'object' && !Array.isArray(agent)
        ? (agent as Record<string, unknown>).disabled_toolsets
        : undefined

    const rawImage = config.image_gen
    const image = rawImage && typeof rawImage === 'object' && !Array.isArray(rawImage) ? rawImage as Record<string, unknown> : null

    // An explicit exclusion and a non-managed backend both skip chat's optional
    // preparation, but an avatar request must fail before spending a request.
    if ((Array.isArray(disabled) ? disabled : [disabled]).includes('image_gen') || image?.provider !== 'aino') {
      if (required) { throw new PlatformSelectionError('model_unavailable') }

      return
    }

    if (typeof image.model !== 'string' || !image.model.trim()) {
      throw new PlatformSelectionError('model_unavailable')
    }

    const catalog = platformModelCatalog()
    await catalog.load()
    const account = catalog.account.get()
    const ownerUserId = account?.account?.id || ''
    requirePlatformSelection(account, catalog.state.get().models, image.model, ownerUserId, 'image')
    const authority = catalog.owner.state.get().owner

    if (!authority) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    await bindSelectedPlatformSession(
      bindingOwner,
      sessionId,
      {
        modelId: image.model,
        ownerUserId,
        platformOrigin: authority.platform_origin,
        status: 'awaiting_managed_credentials'
      },
      request,
      true,
      account ?? undefined,
      'image'
    )
  } catch (error) {
    if (required) { throw error }
    notify({
      id: `aino-image-binding:${captured.key}:${sessionId}`,
      kind: 'warning',
      title: translateNow('settings.model.imageGeneration.title'),
      message: translateNow('settings.model.imageGeneration.unavailable'),
      action: {
        label: translateNow('settings.model.imageGeneration.title'),
        onClick: () => requestRoute('/settings?tab=config:model&page=main&setting=model.image-generation')
      }
    })
  }
}
