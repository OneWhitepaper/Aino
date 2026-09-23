import { atom } from 'nanostores'

import type {
  PhoneChallengeDTO,
  PhoneVerifyDTO,
  PlatformAccountSnapshot,
  PlatformAuthResult,
  PlatformPublicCapabilities
} from '../../shared/platform-contract'

import { reconcilePlatformDraftAccount } from './platform-draft-model'

export type AccountRecord = NonNullable<PlatformAccountSnapshot['account']>

export interface AccountError {
  code: string
  retryAfter?: number
}

export interface AccountState {
  authenticated: boolean
  account: AccountRecord | null
  adapter: 'legacy-development' | 'platform'
  capabilities: PlatformPublicCapabilities | null
  fixedCodeHint: boolean
  ready: boolean
  loading: boolean
  phase: PlatformAccountSnapshot['phase']
  rememberState: PlatformAccountSnapshot['remember_state']
  error: AccountError | null
}

export interface AccountAdapter {
  kind: AccountState['adapter']
  fixedCodeHint: boolean
  status(): Promise<PlatformAccountSnapshot>
  capabilities(): Promise<PlatformPublicCapabilities>
  retry(): Promise<PlatformAccountSnapshot>
  requestPhoneCode(phone: string): Promise<PhoneChallengeDTO>
  verifyPhoneCode(input: PhoneVerifyDTO): Promise<PlatformAuthResult>
  loginExisting(input: { email: string; password: string; remember: boolean }): Promise<PlatformAuthResult>
  completeSecondFactor(code: string): Promise<PlatformAccountSnapshot>
  updateProfile(displayName: string): Promise<PlatformAccountSnapshot>
  logout(): Promise<PlatformAccountSnapshot>
  onChanged(listener: (snapshot: PlatformAccountSnapshot) => void): () => void
}

const INITIAL_STATE: Omit<AccountState, 'adapter' | 'fixedCodeHint'> = {
  authenticated: false,
  account: null,
  capabilities: null,
  ready: false,
  loading: false,
  phase: 'loading',
  rememberState: 'session_only',
  error: null
}

function safeError(error: unknown): AccountError {
  const source = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const candidate = typeof source.code === 'string' ? source.code : 'platform_error'
  const code = /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : 'platform_error'
  const retry = source.retryAfter ?? source.retry_after

  return {
    code,
    ...(typeof retry === 'number' && Number.isSafeInteger(retry) && retry >= 0 ? { retryAfter: retry } : {})
  }
}

function snapshotError(snapshot: PlatformAccountSnapshot): AccountError | null {
  return snapshot.error
    ? {
        code: snapshot.error.code,
        ...(snapshot.error.retry_after === undefined ? {} : { retryAfter: snapshot.error.retry_after })
      }
    : null
}

export function createAccountActions(adapter: AccountAdapter) {
  const snapshot = atom<PlatformAccountSnapshot | null>(null)

  const state = atom<AccountState>({
    ...INITIAL_STATE,
    adapter: adapter.kind,
    fixedCodeHint: adapter.fixedCodeHint
  })

  let operation = 0
  let snapshotRevision = -1

  const applySnapshot = (next: PlatformAccountSnapshot) => {
    if (next.revision < snapshotRevision) {
      return false
    }

    snapshotRevision = next.revision

    if (adapter.kind === 'platform') {
      reconcilePlatformDraftAccount(next)
    }

    snapshot.set(next)
    const current = state.get()
    state.set({
      ...current,
      authenticated: Boolean(next.account && next.phase !== 'signed_out' && next.phase !== 'reauth_required'),
      account: next.account,
      ready: true,
      phase: next.phase,
      rememberState: next.remember_state,
      error: snapshotError(next) ?? (current.capabilities ? null : current.error)
    })

    return true
  }

  const run = async <T>(task: () => Promise<T>, apply?: (value: T) => void): Promise<T | null> => {
    const current = ++operation
    state.set({ ...state.get(), loading: true, error: null })

    try {
      const value = await task()

      if (current !== operation) {
        return null
      }

      apply?.(value)
      state.set({ ...state.get(), loading: false })

      return value
    } catch (error) {
      if (current === operation) {
        state.set({ ...state.get(), loading: false, ready: true, error: safeError(error) })
      }

      return null
    }
  }

  adapter.onChanged(snapshot => {
    applySnapshot(snapshot)
  })

  const load = (status: () => Promise<PlatformAccountSnapshot>) =>
    run(
      async () => {
        const [statusResult, capabilitiesResult] = await Promise.allSettled([status(), adapter.capabilities()])

        if (statusResult.status === 'fulfilled') {
          applySnapshot(statusResult.value)
        }

        if (capabilitiesResult.status === 'rejected') {
          throw capabilitiesResult.reason
        }

        if (statusResult.status === 'rejected') {
          throw statusResult.reason
        }

        return [statusResult.value, capabilitiesResult.value] as const
      },
      ([snapshot, capabilities]) => {
        applySnapshot(snapshot)
        state.set({ ...state.get(), capabilities, ready: true })
      }
    )

  return {
    state,
    snapshot,
    refresh: () => load(() => adapter.status()),
    retry: () => (state.get().capabilities ? run(() => adapter.retry(), applySnapshot) : load(() => adapter.retry())),
    requestPhoneCode: (phone: string) => run(() => adapter.requestPhoneCode(phone.trim())),
    verifyPhoneCode: (input: PhoneVerifyDTO) =>
      run(
        () => adapter.verifyPhoneCode({ ...input, phone: input.phone.trim(), code: input.code.trim() }),
        result => {
          if (result.status === 'signed_in') {
            applySnapshot(result.snapshot)
          }
        }
      ),
    loginExisting: (input: { email: string; password: string; remember: boolean }) =>
      run(
        () => adapter.loginExisting({ ...input, email: input.email.trim() }),
        result => {
          if (result.status === 'signed_in') {
            applySnapshot(result.snapshot)
          }
        }
      ),
    completeSecondFactor: (code: string) => run(() => adapter.completeSecondFactor(code.trim()), applySnapshot),
    updateProfile: (displayName: string) => run(() => adapter.updateProfile(displayName.trim()), applySnapshot),
    logout: () => run(() => adapter.logout(), applySnapshot)
  }
}

export type AccountActions = ReturnType<typeof createAccountActions>
