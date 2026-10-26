import { atom, computed, type ReadableAtom } from 'nanostores'

import { platformAccountActions } from '@/api/platform'
import { translateNow } from '@/i18n'
import { platformDefaultScope, type PlatformDefaultScopeInput } from '@/lib/platform-model-scope'
import { readKey, writeKey } from '@/lib/storage'

import type { PlatformAccountSnapshot, PlatformModel } from '../../shared/platform-contract'

import { createPlatformModelOwner, type PlatformModelOwner, samePlatformAccount } from './platform-model-owner'

export interface PlatformCatalogState {
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'signed_out'
  models: PlatformModel[]
  error: string | null
}

const PLATFORM_DEFAULT_PREFIX = 'aino.desktop.platform-default.'

function currentOrigin(accountId: string, mode: string): string | null {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const owner = catalog.owner.state.get().owner

  return account?.mode === mode && owner?.user_id === accountId ? owner.platform_origin : null
}

export function platformDefaultKey(
  accountId: string,
  scope: PlatformDefaultScopeInput | undefined,
  mode: string,
  origin: string
) {
  const { key } = platformDefaultScope(scope)
  const accountKey = `${PLATFORM_DEFAULT_PREFIX}${encodeURIComponent(accountId)}`

  return `${accountKey}.scope.${encodeURIComponent(JSON.stringify([mode, origin, key]))}`
}

export function readPlatformDefault(
  accountId: string,
  scope?: PlatformDefaultScopeInput,
  mode = 'production',
  origin = currentOrigin(accountId, mode)
): string | null {
  if (!accountId || !origin) {
    return null
  }
  const value = readKey(platformDefaultKey(accountId, scope, mode, origin))

  if (value !== null) {
    return value
  }

  return mode === 'production' &&
    origin === 'https://api.agentera.com.cn' &&
    platformDefaultScope(scope).key === '["legacy-local","default"]'
    ? readKey(`${PLATFORM_DEFAULT_PREFIX}${encodeURIComponent(accountId)}`)
    : null
}

export function writePlatformDefault(
  accountId: string,
  modelId: string | null,
  scope?: PlatformDefaultScopeInput,
  mode = 'production',
  origin = currentOrigin(accountId, mode)
) {
  if (!accountId) {
    return
  }

  if (!origin) {
    throw new PlatformSelectionError('platform_account_changed')
  }
  writeKey(platformDefaultKey(accountId, scope, mode, origin), modelId)
}

export class PlatformSelectionError extends Error {
  constructor(readonly code: string) {
    super(translateNow(platformErrorKey(code)))
    this.name = 'PlatformSelectionError'
  }
}

function platformErrorKey(code: string) {
  const keys = {
    not_authenticated: 'platformModels.not_authenticated',
    platform_account_changed: 'platformModels.platform_account_changed',
    stale_account_revision: 'platformModels.platform_account_changed',
    insufficient_balance: 'platformModels.insufficient_balance',
    quota_exhausted: 'platformModels.quota_exhausted',
    unsupported_gateway: 'platformModels.unsupported',
    model_unavailable: 'platformModels.unavailable'
  } as const

  return keys[code as keyof typeof keys] ?? 'platformModels.bindingFailed'
}

export function requirePlatformSelection(
  account: PlatformAccountSnapshot | null,
  models: PlatformModel[],
  modelId: string,
  ownerUserId: string
): PlatformModel {
  if (account?.phase !== 'signed_in' || !account.account) {
    throw new PlatformSelectionError('not_authenticated')
  }

  if (ownerUserId !== account.account.id) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  const model = models.find(row => row.id === modelId)

  if (!model || model.state !== 'available') {
    throw new PlatformSelectionError(model?.state || 'model_unavailable')
  }

  return model
}

/** Account revision fences both in-flight responses and the visible cache. */
export function createPlatformModelCatalog(
  account: ReadableAtom<PlatformAccountSnapshot | null>,
  list: () => Promise<PlatformModel[]>,
  lookupOwner: (revision: number) => Promise<PlatformModelOwner> = async () => {
    throw new Error('owner_unavailable')
  }
) {
  const sameAccount = samePlatformAccount
  const owner = createPlatformModelOwner(account, lookupOwner)

  const result = atom<{ snapshot: PlatformAccountSnapshot | null; data: PlatformCatalogState }>({
    snapshot: null,
    data: { phase: 'idle', models: [], error: null }
  })

  const state = computed([account, result], (current, cached): PlatformCatalogState => {
    if (current?.phase !== 'signed_in' || !current.account) {
      return { phase: 'signed_out', models: [], error: null }
    }

    return sameAccount(current, cached.snapshot) ? cached.data : { phase: 'idle', models: [], error: null }
  })

  let pending: { snapshot: PlatformAccountSnapshot; promise: Promise<void> } | null = null

  const load = (): Promise<void> => {
    const snapshot = account.get()

    if (snapshot?.phase !== 'signed_in' || !snapshot.account) {
      return Promise.resolve()
    }

    if (pending && sameAccount(pending.snapshot, snapshot)) {
      return pending.promise
    }

    result.set({ snapshot, data: { ...state.get(), phase: 'loading', error: null } })

    const promise = Promise.all([list(), owner.load()])
      .then(([models]) => {
        if (sameAccount(account.get(), snapshot)) {
          result.set({ snapshot, data: { phase: 'ready', models, error: null } })
        }
      })
      .catch(() => {
        if (sameAccount(account.get(), snapshot)) {
          result.set({ snapshot, data: { ...state.get(), phase: 'error', error: 'catalog_unavailable' } })
        }
      })
      .finally(() => {
        if (pending?.promise === promise) {
          pending = null
        }
      })

    pending = { snapshot, promise }

    return promise
  }

  return { state, account, owner, load }
}

const unavailable = createPlatformModelCatalog(atom<PlatformAccountSnapshot | null>(null), async () => [])
let cached: { bridge: NonNullable<Window['hermesDesktop']>['platformAccount']; catalog: typeof unavailable } | undefined

export function platformModelCatalog() {
  const desktop = window.hermesDesktop

  if (!desktop?.platformAccount || !desktop.platformModels) {
    return unavailable
  }

  if (cached?.bridge !== desktop.platformAccount) {
    const actions = platformAccountActions(desktop.platformAccount)
    cached = {
      bridge: desktop.platformAccount,
      catalog: createPlatformModelCatalog(
        actions.snapshot,
        () => desktop.platformModels.list(),
        revision => desktop.platformModels.owner(revision)
      )
    }
  }

  return cached.catalog
}
