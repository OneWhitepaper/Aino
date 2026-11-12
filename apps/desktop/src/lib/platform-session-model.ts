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

/** Picker snapshots distinguish no selection from a lazy runtime's silent default. */
export function isUnselectedSessionModel(
  info:
    | { model?: unknown; provider?: unknown; model_id?: unknown; model_source?: unknown; running?: unknown }
    | null
    | undefined
): boolean {
  return Boolean(
    info &&
    Object.hasOwn(info, 'model') &&
    Object.hasOwn(info, 'provider') &&
    (info.model === '' || info.model === null) &&
    (info.provider === '' || info.provider === null) &&
    !info.model_id &&
    !info.model_source &&
    !info.running
  )
}

export interface CanonicalModelRow {
  id?: string
  profile?: null | string
  connection_id?: null | string
  title?: null | string
  hidden?: unknown
  message_count?: unknown
  parent_session_id?: unknown
  archived?: unknown
  model_config?: unknown
}

/** A follow-profile marker carries no explicit session model/provider pin. */
export function unselectedCanonicalModelRow(
  row: CanonicalModelRow,
  storedId: string,
  owner: { connectionId?: string; profile: string }
): boolean {
  if (
    row.id !== storedId ||
    row.profile !== owner.profile ||
    (row.connection_id && row.connection_id !== owner.connectionId) ||
    row.title !== 'Bot Chat' ||
    (row.hidden !== true && row.hidden !== 1) ||
    row.message_count !== 0 ||
    row.parent_session_id ||
    row.archived
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

  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    (config as Record<string, unknown>).follow_profile_config !== true
  ) {
    return false
  }

  return Object.entries(config).every(
    ([key, value]) => (key === 'follow_profile_config' || key === 'yolo_mode') && typeof value === 'boolean'
  )
}

/** A never-used staged selection can be explicitly bound on its exact owner route. */
export function unboundManagedSessionRow(
  row: CanonicalModelRow,
  storedId: string,
  owner: { connectionId?: string; profile: string },
  modelId: string
): boolean {
  if (
    row.id !== storedId ||
    row.profile !== owner.profile ||
    (row.connection_id && row.connection_id !== owner.connectionId) ||
    row.message_count !== 0 ||
    row.parent_session_id ||
    row.archived
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

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false
  }

  const selected = config as Record<string, unknown>

  return (
    selected.model_source === 'aino' &&
    selected.model_id === modelId &&
    !Object.hasOwn(selected, 'platform_owner') &&
    Object.entries(selected).every(([key, value]) => {
      if (key === 'model_source' || key === 'model_id') {
        return true
      }

      if (key === 'provider') {
        return value === 'aino'
      }

      return (key === 'follow_profile_config' || key === 'yolo_mode') && typeof value === 'boolean'
    })
  )
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
