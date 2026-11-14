import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useMemo, useState } from 'react'

import { platformAccountActions } from '@/api/platform'
import { reconcileTurnUsage, type TurnCost } from '@/lib/platform-usage-reconciliation'
import { queryClient } from '@/lib/query-client'
import type { TurnBilling } from '@/lib/turn-billing'

import type {
  PlatformAccountSnapshot,
  PlatformBillingBridge,
  PlatformUsageRow
} from '../../../../shared/platform-contract'

const unavailable = atom<PlatformAccountSnapshot | null>(null)
const DELAYS = [2000, 5000, 10000, 20000, 30000]
const pending: TurnCost = { status: 'pending', amount: null }

interface CostResult {
  key: string
  exhausted: boolean
}

interface TurnUsage {
  rows: PlatformUsageRow[]
  allPages: boolean
}

async function readTurnUsage(
  bridge: PlatformBillingBridge,
  billing: TurnBilling,
  signal: AbortSignal
): Promise<TurnUsage> {
  const rows: PlatformUsageRow[] = []
  let allPages = false
  let expectedTotal: number | undefined
  const uniqueRowIds = new Set<string>()

  for (let page = 1; page <= 4 && !signal.aborted; page += 1) {
    const result = await bridge.listUsage({
      expected_user_id: billing.user_id,
      page,
      page_size: 50,
      session_id: billing.session_id,
      desktop_turn_id: billing.turn_id
    })

    const pageRows = result.items.slice(0, 50)
    rows.push(...pageRows)
    pageRows.forEach(row => uniqueRowIds.add(row.id))

    if (
      result.page !== page ||
      result.page_size !== 50 ||
      result.items.length > 50 ||
      (expectedTotal !== undefined && result.total !== expectedTotal)
    ) {
      break
    }

    expectedTotal = result.total

    if (uniqueRowIds.size === expectedTotal) {
      allPages = true

      break
    }

    if (uniqueRowIds.size > expectedTotal || result.items.length === 0) {
      break
    }
  }

  return { rows, allPages }
}

export function useTurnCost(billing: TurnBilling) {
  const desktop = window.hermesDesktop

  const snapshot = useStore(
    desktop?.platformAccount ? platformAccountActions(desktop.platformAccount).snapshot : unavailable
  )

  const bridge = desktop?.platformBilling
  const owner = snapshot?.account?.id

  const needsLogin =
    owner !== billing.user_id || snapshot?.phase === 'signed_out' || snapshot?.phase === 'reauth_required'

  const available = (snapshot?.phase === 'signed_in' || snapshot?.phase === 'offline') && !needsLogin && Boolean(bridge)
  const [retry, setRetry] = useState(0)
  const receipt = JSON.stringify(billing)
  const key = `${snapshot?.mode}:${owner}:${available}:${receipt}:${retry}`

  const usageKey = useMemo(
    () => ['billing', 'platform', 'turn-cost', snapshot?.mode, owner, billing.session_id, billing.turn_id],
    [snapshot?.mode, owner, billing.session_id, billing.turn_id]
  )

  const [result, setResult] = useState<CostResult>({ key: '', exhausted: false })
  // Read synchronously on remount. Account changes retire this existing billing cache root.
  const usage = available ? queryClient.getQueryData<TurnUsage>(usageKey) : undefined
  const cost = usage ? reconcileTurnUsage(billing, usage.rows, usage.allPages) : pending

  useEffect(() => {
    if (!available || !bridge) {
      return
    }

    // Equivalent metadata objects must not restart polling or reset its budget.
    const billing: TurnBilling = JSON.parse(receipt)
    let alive = true
    let inflight = false
    let attempts = 0
    let done = false
    let blocked = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      if (!alive || inflight || done || document.visibilityState === 'hidden') {
        return
      }

      inflight = true
      attempts += 1

      try {
        const cached = queryClient.getQueryData<TurnUsage>(usageKey)
        const settled = cached && reconcileTurnUsage(billing, cached.rows, cached.allPages).status === 'settled'

        const usage = await queryClient.fetchQuery({
          queryKey: usageKey,
          staleTime: settled ? 60_000 : 0,
          // Historical charges survive navigation for this account's window lifetime.
          // fetchQuery has no observer, so its default idle GC also ran while visible.
          gcTime: Infinity,
          retry: false,
          networkMode: 'always',
          queryFn: ({ signal }) => readTurnUsage(bridge, billing, signal)
        })

        done = reconcileTurnUsage(billing, usage.rows, usage.allPages).status === 'settled'
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : ''

        if (['not_authenticated', 'platform_account_changed', 'auth_attempt_superseded'].includes(String(code))) {
          blocked = true
          done = true
        }
      } finally {
        inflight = false

        if (alive) {
          const exhausted = blocked || (!done && attempts > DELAYS.length)
          setResult({ key, exhausted })

          if (!done && !exhausted) {
            timer = setTimeout(() => void run(), DELAYS[attempts - 1])
          }

          if (exhausted) {
            done = true
          }
        }
      }
    }

    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer)

        return
      }

      clearTimeout(timer)
      void run()
    }

    void run()
    document.addEventListener('visibilitychange', visibility)

    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [available, bridge, key, receipt, usageKey])

  return {
    cost,
    rows: [
      ...new Map(
        (usage?.rows ?? [])
          .filter(row => row.session_id === billing.session_id && row.desktop_turn_id === billing.turn_id)
          .map(row => [row.id, row])
      ).values()
    ],
    truncated: usage ? !usage.allPages : false,
    exhausted: available && result.key === key && result.exhausted,
    available,
    needsLogin,
    retry: () => setRetry(value => value + 1)
  }
}
