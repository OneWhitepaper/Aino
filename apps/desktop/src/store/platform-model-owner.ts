import { atom, computed, type ReadableAtom } from 'nanostores'

import type { PlatformAccountSnapshot } from '../../shared/platform-contract'

export interface PlatformModelOwner {
  user_id: string
  platform_origin: string
}

export interface PlatformModelOwnerState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  owner: PlatformModelOwner | null
}

export function samePlatformAccount(left: PlatformAccountSnapshot | null, right: PlatformAccountSnapshot | null) {
  return (
    left?.phase === 'signed_in' &&
    right?.phase === 'signed_in' &&
    left.revision === right.revision &&
    left.mode === right.mode &&
    left.account?.id === right.account?.id
  )
}

/** Main owns commercial identity; renderer caches only its public, revision-fenced answer. */
export function createPlatformModelOwner(
  account: ReadableAtom<PlatformAccountSnapshot | null>,
  lookup: (revision: number) => Promise<PlatformModelOwner>
) {
  const result = atom<{ snapshot: PlatformAccountSnapshot | null; data: PlatformModelOwnerState }>({
    snapshot: null,
    data: { phase: 'idle', owner: null }
  })

  const state = computed([account, result], (current, cached): PlatformModelOwnerState =>
    samePlatformAccount(current, cached.snapshot) ? cached.data : { phase: 'idle', owner: null }
  )

  let pending: { snapshot: PlatformAccountSnapshot; promise: Promise<void> } | null = null

  const load = (): Promise<void> => {
    const snapshot = account.get()

    if (snapshot?.phase !== 'signed_in' || !snapshot.account || state.get().phase === 'ready') {
      return Promise.resolve()
    }

    if (pending && samePlatformAccount(snapshot, pending.snapshot)) {
      return pending.promise
    }
    result.set({ snapshot, data: { phase: 'loading', owner: null } })

    const promise = Promise.resolve()
      .then(() => lookup(snapshot.revision))
      .then(owner => {
        if (!samePlatformAccount(account.get(), snapshot)) {
          return
        }

        if (owner.user_id !== snapshot.account?.id || !owner.platform_origin) {
          throw new Error('platform_owner_mismatch')
        }
        result.set({ snapshot, data: { phase: 'ready', owner } })
      })
      .catch(() => {
        if (samePlatformAccount(account.get(), snapshot)) {
          result.set({ snapshot, data: { phase: 'error', owner: null } })
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

  return { state, load }
}
