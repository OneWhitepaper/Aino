import { resolveModelDefault } from '@/lib/model-default'
import { activeGatewayConnectionId } from '@/store/gateway'
import { platformModelForDisplayFrom } from '@/store/platform-model-capability'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'

import type { PluginProfileRoute } from './profile-request'

/** The same effective default used when creating a conversation, without saving a preference. */
export async function readProfileEffectiveModel(profile: string, route?: PluginProfileRoute) {
  const name = profile.trim()

  if (
    !name ||
    (route && (route.profile.trim() !== name || !route.targetProfile.trim() || !route.connectionId.trim()))
  ) {
    throw new Error('Bot model lookup requires a matching profile owner')
  }

  const connectionId = route?.connectionId.trim() || activeGatewayConnectionId() || 'local'
  const scope = { connectionId, profile: route?.targetProfile.trim() || name }
  const resolved = await resolveModelDefault(scope, { connectionId, profile: name })

  if (!resolved.model && !resolved.provider) {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  const platform = resolved.platform
    ? platformModelForDisplayFrom(
        platformModelCatalog(),
        resolved.platform.modelId,
        resolved.platform.ownerUserId,
        resolved.platform.platformOrigin
      )
    : null

  return { model: resolved.model, provider: resolved.provider, label: platform?.display_name || resolved.model }
}
