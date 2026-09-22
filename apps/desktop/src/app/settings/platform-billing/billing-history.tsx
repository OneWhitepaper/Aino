import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { RefreshCw } from '@/lib/icons'
import { LEGACY_USAGE_PURPOSES } from '@/lib/turn-billing'

import type {
  PlatformBillingBridge,
  PlatformBillingScope,
  PlatformOrderPage,
  PlatformUsagePage
} from '../../../../shared/platform-contract'

import { HistoryPagination } from './history-pagination'
import { type UsageFilters, UsageFiltersForm } from './usage-filters'
import { formatUsageAmount, UsageView } from './usage-view'

interface BillingHistoryProps {
  bridge: PlatformBillingBridge
  scope: PlatformBillingScope
  onOpenOrder: (orderId: string) => void
}

export function BillingHistory({ bridge, scope, onOpenOrder }: BillingHistoryProps) {
  const { t, locale } = useI18n()
  const copy = t.platformBillingHistory
  const [mode, setMode] = useState<'orders' | 'usage'>('orders')
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState<UsageFilters>({})

  const [purposes, setPurposes] = useState<{ scopeKey: string; values: readonly string[] }>({
    scopeKey: '',
    values: LEGACY_USAGE_PURPOSES
  })

  const [retry, setRetry] = useState(0)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const scopeKey = JSON.stringify([scope.origin, scope.user_id, scope.generation])

  const [result, setResult] = useState<{
    key: string
    data: PlatformOrderPage | PlatformUsagePage | null
    error: boolean
  }>({ key: '', data: null, error: false })

  const key = JSON.stringify([scopeKey, mode, page, pageSize, filters, timezone, retry])
  const origin = scope.origin
  const owner = scope.user_id
  const generation = scope.generation

  useEffect(() => {
    if (!expanded) {
      return
    }

    let alive = true
    let request = 0

    const load = async () => {
      if (document.visibilityState === 'hidden') {
        return
      }

      const currentRequest = ++request

      try {
        const query = { expected_user_id: owner, page, page_size: pageSize }

        const data =
          mode === 'orders'
            ? await bridge.listOrders(query)
            : await bridge.listUsage({ ...query, ...filters, timezone })

        const current = await bridge.scope({ expected_user_id: owner })

        if (
          current.origin !== origin ||
          current.user_id !== owner ||
          current.generation !== generation ||
          data.page !== page ||
          data.page_size !== pageSize
        ) {
          throw new Error('scope_or_page_changed')
        }

        if (alive && currentRequest === request) {
          if (mode === 'usage') {
            setPurposes({
              scopeKey,
              values: (data as PlatformUsagePage).supported_desktop_purposes ?? LEGACY_USAGE_PURPOSES
            })
          }

          const lastPage = Math.max(1, Math.ceil(data.total / pageSize))

          if (page > lastPage) {
            setPage(lastPage)

            return
          }

          setResult({ key, data, error: false })
        }
      } catch {
        if (alive && currentRequest === request) {
          setResult({ key, data: null, error: true })
        }
      }
    }

    void load()

    const visible = () => {
      if (document.visibilityState !== 'hidden') {
        void load()
      }
    }

    document.addEventListener('visibilitychange', visible)

    return () => {
      alive = false
      document.removeEventListener('visibilitychange', visible)
    }
  }, [bridge, expanded, generation, key, mode, origin, owner, page, pageSize, filters, timezone, scopeKey])

  const data = result.key === key ? result.data : null
  const error = result.key === key && result.error

  return (
    <section className="my-6 min-w-0">
      <SegmentedControl
        onChange={value => {
          setMode(value)
          setPage(1)
          setExpanded(true)
        }}
        options={[
          { id: 'orders', label: copy.orders },
          { id: 'usage', label: copy.usage }
        ]}
        value={mode}
      />
      {expanded && (
        <div className="mt-4 min-w-0">
          {mode === 'usage' && (
            <UsageFiltersForm
              initialFilters={filters}
              key={scopeKey}
              onApply={next => {
                setFilters(next)
                setPage(1)
                setRetry(value => value + 1)
              }}
              purposes={purposes.scopeKey === scopeKey ? purposes.values : LEGACY_USAGE_PURPOSES}
              timezone={timezone}
            />
          )}
          {error ? (
            <div className="flex flex-wrap items-center gap-3 text-sm" role="alert">
              <span>{copy.error}</span>
              <Button onClick={() => setRetry(value => value + 1)} size="sm" variant="ghost">
                <RefreshCw />
                {copy.retry}
              </Button>
            </div>
          ) : !data ? (
            <Loader />
          ) : (
            <>
              {mode === 'usage' ? (
                data.items.length === 0 && Object.keys(filters).length > 0 ? (
                  <p className="text-sm text-muted-foreground">{copy.noMatches}</p>
                ) : (
                  <UsageView rows={(data as PlatformUsagePage).items} variant="table" />
                )
              ) : data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.empty}</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {(data as PlatformOrderPage).items.map(order => (
                    <li key={order.order_id}>
                      <Button
                        className="w-full justify-between text-left"
                        onClick={() => onOpenOrder(order.order_id)}
                        variant="ghost"
                      >
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          {order.out_trade_no}
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString(locale)} ·{' '}
                            {t.platformRecharge.status[order.status]}
                          </span>
                        </span>
                        <span className="shrink-0 text-right tabular-nums">
                          {formatUsageAmount(order.pay_amount)} {order.payment_currency}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <HistoryPagination
                onPage={setPage}
                onPageSize={size => {
                  setPageSize(size)
                  setPage(1)
                }}
                page={page}
                pageSize={pageSize}
                total={data.total}
              />
            </>
          )}
        </div>
      )}
    </section>
  )
}
