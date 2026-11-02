import './account-history.css'

import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { RefreshCw, SlidersHorizontal } from '@/lib/icons'
import { LEGACY_USAGE_PURPOSES } from '@/lib/turn-billing'

import type {
  PlatformBillingBridge,
  PlatformBillingScope,
  PlatformOrderPage,
  PlatformOrderStatus,
  PlatformUsagePage
} from '../../../../shared/platform-contract'
import { Pill } from '../primitives'

import { HistoryPagination } from './history-pagination'
import { type UsageFilters, UsageFiltersForm } from './usage-filters'
import { formatUsageAmount, UsageView } from './usage-view'

interface BillingHistoryProps {
  bridge: PlatformBillingBridge
  scope: PlatformBillingScope
  onOpenOrder: (orderId: string) => void
}

const ORDER_STATUS_TONES: Partial<Record<PlatformOrderStatus, 'success' | 'warn'>> = {
  COMPLETED: 'success',
  PENDING: 'warn',
  RECHARGING: 'warn'
}

export function BillingHistory({ bridge, scope, onOpenOrder }: BillingHistoryProps) {
  const { t, locale } = useI18n()
  const copy = t.platformBillingHistory
  const accountCopy = t.accountPage
  const [mode, setMode] = useState<'orders' | 'usage'>('orders')
  const [filtersOpen, setFiltersOpen] = useState(false)
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
  const filtersId = useId()

  useEffect(() => {
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
  }, [bridge, generation, key, mode, origin, owner, page, pageSize, filters, timezone, scopeKey])

  const data = result.key === key ? result.data : null
  const error = result.key === key && result.error

  return (
    <section aria-label={accountCopy.historyTitle} className="account-history">
      <div className="account-history-heading">
        <h2>{accountCopy.historyTitle}</h2>
        <p>{accountCopy.historyDescription}</p>
      </div>
      <div className="account-history-toolbar">
        <SegmentedControl
          className="account-history-tabs"
          onChange={value => {
            setMode(value)
            setPage(1)
          }}
          options={[
            { id: 'orders', label: copy.orders },
            { id: 'usage', label: copy.usage }
          ]}
          sizing="content"
          value={mode}
          variant="underline"
        />
        <div className="account-history-actions">
          {mode === 'usage' && (
            <Button
              aria-controls={filtersId}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(value => !value)}
              size="sm"
              variant="ghost"
            >
              <SlidersHorizontal />
              {accountCopy.filters}
            </Button>
          )}
          <Button
            aria-label={accountCopy.refreshHistory}
            onClick={() => setRetry(value => value + 1)}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCw />
          </Button>
        </div>
      </div>
      <div className="account-history-content">
        {mode === 'usage' && (
          <div hidden={!filtersOpen} id={filtersId}>
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
          </div>
        )}
        {error ? (
          <div className="account-history-state flex flex-wrap items-center gap-3 text-sm" role="alert">
            <span>{copy.error}</span>
            <Button onClick={() => setRetry(value => value + 1)} size="sm" variant="ghost">
              <RefreshCw />
              {copy.retry}
            </Button>
          </div>
        ) : !data ? (
          <div className="account-history-state">
            <Loader />
          </div>
        ) : (
          <>
            {mode === 'usage' ? (
              data.items.length === 0 && Object.keys(filters).length > 0 ? (
                <p className="account-history-state text-sm text-muted-foreground">{copy.noMatches}</p>
              ) : (
                <UsageView rows={(data as PlatformUsagePage).items} variant="table" />
              )
            ) : data.items.length === 0 ? (
              <p className="account-history-state text-sm text-muted-foreground">{copy.empty}</p>
            ) : (
              <div className="account-ledger-table-wrap">
                <table
                  aria-label={copy.orders}
                  className="account-ledger-table account-order-table"
                  data-slot="aino-data-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">{accountCopy.columns.order}</th>
                      <th scope="col">{accountCopy.columns.created}</th>
                      <th scope="col">{accountCopy.columns.status}</th>
                      <th className="account-ledger-cost" scope="col">
                        {accountCopy.columns.amount}
                      </th>
                      <th scope="col">
                        <span className="sr-only">{accountCopy.columns.actions}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data as PlatformOrderPage).items.map(order => (
                      <tr className="account-ledger-record" key={order.order_id}>
                        <td className="account-order-id">{order.out_trade_no}</td>
                        <td className="account-ledger-time">
                          <time dateTime={order.created_at}>
                            <span>{new Date(order.created_at).toLocaleDateString(locale)}</span>
                            <span className="account-ledger-time-secondary">
                              {new Date(order.created_at).toLocaleTimeString(locale, {
                                hour: '2-digit',
                                minute: '2-digit',
                                hourCycle: 'h23'
                              })}
                            </span>
                          </time>
                        </td>
                        <td className="account-ledger-status">
                          <Pill tone={ORDER_STATUS_TONES[order.status] ?? 'muted'}>
                            {t.platformRecharge.status[order.status]}
                          </Pill>
                        </td>
                        <td className="account-ledger-cost">
                          {formatUsageAmount(order.pay_amount)} {order.payment_currency}
                        </td>
                        <td className="account-ledger-action">
                          <Button
                            aria-label={`${accountCopy.viewOrder} ${order.out_trade_no}`}
                            onClick={() => onOpenOrder(order.order_id)}
                            size="xs"
                            variant="ghost"
                          >
                            {accountCopy.viewOrder}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
    </section>
  )
}
