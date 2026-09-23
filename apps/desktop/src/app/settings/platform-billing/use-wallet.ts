import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useState } from 'react'

import { platformAccountActions, platformBillingQueryKey, samePlatformBillingScope } from '@/api/platform'
import { queryClient } from '@/lib/query-client'

import type {
  PlatformAccountSnapshot,
  PlatformBillingScope,
  PlatformWalletSummary
} from '../../../../shared/platform-contract'

const unavailable = atom<PlatformAccountSnapshot | null>(null)

interface WalletResult {
  key: string
  wallet: PlatformWalletSummary | null
  error: string | null
  loading: boolean
  scope: PlatformBillingScope | null
}

export function useWallet() {
  const desktop = window.hermesDesktop
  const bridge = desktop?.platformBilling

  const account = desktop?.platformAccount ? platformAccountActions(desktop.platformAccount).snapshot : unavailable
  const snapshot = useStore(account)

  const owner = snapshot?.account?.id
  const available = Boolean(owner && bridge && ['signed_in', 'offline'].includes(snapshot?.phase ?? ''))
  // Read failures publish account revisions too; they must not trigger another read.
  const key = `${snapshot?.mode}:${owner}:${available}`
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<WalletResult>({ key: '', wallet: null, error: null, loading: true, scope: null })

  useEffect(() => {
    if (!available || !owner || !bridge) {
      return
    }

    let alive = true
    let inflight = false
    let lastRead = 0
    let activeScope: PlatformBillingScope | null = null
    let authorityRevision = 0
    let scopeValidation = 0
    const input = { expected_user_id: owner }

    const read = async () => {
      if (!alive || inflight || document.visibilityState === 'hidden') {
        return
      }

      inflight = true
      lastRead = Date.now()
      const revision = authorityRevision
      setResult(previous => ({
        scope: previous.key === key ? previous.scope : null,
        key,
        wallet: previous.key === key ? previous.wallet : null,
        error: null,
        loading: true
      }))

      try {
        const scope = await bridge.scope(input)

        if (!alive || revision !== authorityRevision) {
          return
        }

        activeScope = scope
        const queryKey = [...platformBillingQueryKey(scope), 'wallet']
        const cached = queryClient.getQueryData<PlatformWalletSummary>(queryKey) ?? null
        // Local scope validation is quick; publish it before HTTP so devices load in parallel.
        setResult({ key, scope, wallet: cached, error: null, loading: true })

        const wallet = await queryClient.fetchQuery({
          queryKey,
          staleTime: 0,
          retry: false,
          networkMode: 'always',
          queryFn: async () => {
            const wallet = await bridge.summary(input)
            const current = await bridge.scope(input)

            if (!samePlatformBillingScope(scope, current)) {
              throw Object.assign(new Error('platform_account_changed'), { code: 'platform_account_changed' })
            }

            return wallet
          }
        })

        if (alive && revision === authorityRevision) {
          setResult({ key, wallet, error: null, loading: false, scope })
        }
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'network_error'

        // Scope validation is local. A failed network read can keep data only while
        // this exact login still owns it (including same-user reauthentication).
        let scope: PlatformBillingScope | null = null

        try {
          const current = await bridge.scope(input)

          if (activeScope && samePlatformBillingScope(activeScope, current)) {
            scope = current
          }
        } catch {
          /* No billing authority remains. */
        }

        if (alive && revision === authorityRevision) {
          if (!scope && activeScope) {
            queryClient.removeQueries({ queryKey: platformBillingQueryKey(activeScope) })
          }

          setResult(previous => ({
            key,
            wallet: scope && previous.key === key ? previous.wallet : null,
            error: code,
            loading: false,
            scope
          }))
        }
      } finally {
        inflight = false
      }
    }

    const visible = () => {
      if (Date.now() - lastRead >= 5000) {
        void read()
      }
    }

    // Revisions also announce same-user logout/reauthentication. Check their
    // local generation without repeating wallet HTTP on ordinary offline events.
    const unlisten = account.listen(() => {
      const captured = activeScope
      const validation = ++scopeValidation

      if (!captured) {
        authorityRevision += 1
        setRefresh(value => value + 1)

        return
      }

      void bridge
        .scope(input)
        .then(current => {
          if (!alive || validation !== scopeValidation || samePlatformBillingScope(captured, current)) {
            return
          }

          authorityRevision += 1
          queryClient.removeQueries({ queryKey: platformBillingQueryKey(captured) })
          setResult({ key, wallet: null, error: null, loading: true, scope: null })
          setRefresh(value => value + 1)
        })
        .catch(() => {
          if (!alive || validation !== scopeValidation) {
            return
          }

          authorityRevision += 1

          if (captured) {
            queryClient.removeQueries({ queryKey: platformBillingQueryKey(captured) })
          }

          setResult({ key, wallet: null, error: 'platform_account_changed', loading: false, scope: null })
        })
    })

    void read()
    document.addEventListener('visibilitychange', visible)

    return () => {
      alive = false
      unlisten()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [account, available, bridge, key, owner, refresh])

  return {
    scope: available && result.key === key ? result.scope : null,
    available,
    wallet: available && result.key === key ? result.wallet : null,
    error: available && result.key === key ? result.error : null,
    loading: available && (result.key !== key || result.loading),
    refresh: () => {
      // A recharge may have completed while the previous balance read was in flight.
      if (result.key === key && result.scope) {
        void queryClient.cancelQueries({ queryKey: [...platformBillingQueryKey(result.scope), 'wallet'], exact: true })
      }

      setRefresh(value => value + 1)
    }
  }
}
