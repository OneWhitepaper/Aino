import { requirePlatformSelection } from '@/store/platform-models'

import type { PlatformAccountSnapshot, PlatformModel } from '../../shared/platform-contract'

export interface PlatformSessionModel {
  modelId: string
  ownerUserId: string
  platformOrigin?: string
  status: 'ready' | 'awaiting_managed_credentials'
}

export interface PlatformRuntimeFields {
  model_source?: string
  model_id?: string
  model_status?: string
  platform_owner?: { user_id: string; platform_origin: string }
}

export function samePlatformSessionModel(
  left: PlatformSessionModel | null | undefined,
  right: PlatformSessionModel | null | undefined
): boolean {
  return (
    left?.modelId === right?.modelId &&
    left?.ownerUserId === right?.ownerUserId &&
    left?.platformOrigin === right?.platformOrigin &&
    left?.status === right?.status
  )
}

export function platformModelStatePatch(
  info: (PlatformRuntimeFields & { provider?: string; model?: string; running?: boolean }) | undefined
): {
  model?: string
  platformModel?: PlatformSessionModel | null
} {
  if (info?.model_source === 'aino' && info.model_id) {
    return {
      model: info.model_id,
      platformModel: {
        modelId: info.model_id,
        ownerUserId: info.platform_owner?.user_id || '',
        platformOrigin: info.platform_owner?.platform_origin,
        status: info.model_status === 'ready' ? 'ready' : 'awaiting_managed_credentials'
      }
    }
  }

  return info?.provider && info.provider !== 'aino' ? { platformModel: null } : {}
}

export function platformCreateOverrides(
  provider: string,
  model: string,
  owner: string,
  account: PlatformAccountSnapshot | null,
  catalog: PlatformModel[]
): Record<string, unknown> {
  if (provider === 'aino') {
    requirePlatformSelection(account, catalog, model, owner)

    return { model_source: 'aino', model_id: model }
  }

  return model ? { model, ...(provider ? { provider } : {}) } : {}
}
