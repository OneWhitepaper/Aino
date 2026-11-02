import { Fragment, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { type Translations, useI18n } from '@/i18n'

import type { PlatformUsageRow } from '../../../../shared/platform-contract'
import { Pill } from '../primitives'

interface UsageViewProps {
  rows: PlatformUsageRow[]
  truncated?: boolean
  variant?: 'compact' | 'table'
}

const SETTLEMENT_TONES = {
  settled: 'success',
  not_charged: 'success',
  pending: 'warn',
  unknown: 'muted'
} as const

export function formatUsageAmount(amount: string): string {
  const [whole, fraction = ''] = amount.split('.')
  const trimmed = fraction.replace(/0+$/, '')

  return trimmed ? `${whole}.${trimmed}` : whole
}

function UsagePurpose({ purpose }: { purpose: string | null }) {
  const { t } = useI18n()

  const label =
    purpose && Object.hasOwn(t.platformUsage.purposes, purpose)
      ? t.platformUsage.purposes[purpose as keyof typeof t.platformUsage.purposes]
      : undefined

  return (
    <span>
      <span>{label || t.platformBillingHistory.unknownPurpose}</span>
      {!label && purpose && /^[a-zA-Z0-9_.:-]{1,80}$/.test(purpose) && (
        <code className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]">{purpose}</code>
      )}
    </span>
  )
}

function UsageTime({ value, stacked = false }: { value: string; stacked?: boolean }) {
  const { locale } = useI18n()
  const date = new Date(value)

  if (!Number.isFinite(date.getTime())) {
    return <span>—</span>
  }

  return (
    <time className="tabular-nums" dateTime={value}>
      <span>{new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)}</span>{' '}
      <span className={stacked ? 'block' : undefined}>
        {new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }).format(date)}
      </span>
    </time>
  )
}

function usageAmount(row: PlatformUsageRow, copy: Translations['platformUsage']) {
  const amount =
    row.settlement_status === 'settled' || row.settlement_status === 'not_charged' ? row.actual_cost_decimal : null

  return amount == null ? copy.unverified : `${formatUsageAmount(amount)} USD`
}

function UsageDetails({ row }: { row: PlatformUsageRow }) {
  const { t, locale } = useI18n()
  const copy = t.platformBillingHistory

  const counters = [
    [copy.inputTokens, row.input_tokens],
    [copy.outputTokens, row.output_tokens],
    [copy.cacheReadTokens, row.cache_read_tokens],
    [copy.cacheWriteTokens, row.cache_creation_tokens]
  ] as const

  const identifiers = [
    [copy.requestId, row.request_id],
    [copy.sessionId, row.session_id],
    [copy.turnId, row.desktop_turn_id],
    [copy.callId, row.desktop_call_id]
  ] as const

  return (
    <div className="account-usage-details">
      <dl className="account-usage-counters">
        {counters.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 tabular-nums">
              {typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
                ? value.toLocaleString(locale)
                : copy.unknown}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="account-usage-identifiers">
        {identifiers.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{value || copy.unknown}</span>
              {value && (
                <CopyButton appearance="icon" buttonSize="icon-xs" label={copy.copyField(label)} text={value} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function UsageView({ rows, truncated = false, variant = 'compact' }: UsageViewProps) {
  const { t } = useI18n()
  const copy = t.platformUsage
  const history = t.platformBillingHistory
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const id = useId()

  const statuses = {
    settled: copy.recordSettled,
    not_charged: copy.notCharged,
    pending: copy.pending,
    unknown: copy.unverified
  }

  return (
    <div className={variant === 'table' ? 'account-usage-ledger' : 'min-w-0 text-sm'}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{copy.empty}</p>
      ) : variant === 'table' ? (
        <div className="account-ledger-table-wrap">
          <table
            aria-label={history.usage}
            className="account-ledger-table account-usage-table"
            data-slot="aino-data-table"
          >
            <thead>
              <tr>
                {(['time', 'model', 'purpose', 'cost', 'status'] as const).map(column => (
                  <th className={column === 'cost' ? 'account-ledger-cost' : undefined} key={column} scope="col">
                    {history.columns[column]}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{history.details}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const open = expanded.has(row.id)
                const detailId = `${id}-${index}`

                return (
                  <Fragment key={row.id}>
                    <tr className="account-ledger-record">
                      <td className="account-ledger-time">
                        <UsageTime stacked value={row.created_at} />
                      </td>
                      <td className="account-usage-model">{row.model}</td>
                      <td className="account-usage-purpose">
                        <UsagePurpose purpose={row.desktop_purpose} />
                      </td>
                      <td className="account-ledger-cost">{usageAmount(row, copy)}</td>
                      <td className="account-ledger-status">
                        <Pill tone={SETTLEMENT_TONES[row.settlement_status]}>{statuses[row.settlement_status]}</Pill>
                      </td>
                      <td className="account-ledger-action">
                        <Button
                          aria-controls={detailId}
                          aria-expanded={open}
                          onClick={() => {
                            setExpanded(previous => {
                              const next = new Set(previous)

                              if (next.has(row.id)) {
                                next.delete(row.id)
                              } else {
                                next.add(row.id)
                              }

                              return next
                            })
                          }}
                          size="xs"
                          variant="ghost"
                        >
                          {open ? history.hideDetails : history.details}
                        </Button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="account-usage-detail-row" id={detailId}>
                        <td colSpan={6}>
                          <UsageDetails row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label={copy.details} className="m-0 list-none divide-y divide-(--ui-stroke-tertiary) p-0">
          {rows.map(row => {
            return (
              <li className="grid min-w-0 grid-cols-2 items-start gap-x-4 gap-y-2 py-4" key={row.id}>
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{row.model}</span>
                <span className="text-right tabular-nums [overflow-wrap:anywhere]">{usageAmount(row, copy)}</span>
                <span className="flex min-w-0 flex-wrap items-start gap-x-1.5 text-xs text-muted-foreground">
                  <UsagePurpose purpose={row.desktop_purpose} />
                  <span aria-hidden="true">·</span>
                  <span>{statuses[row.settlement_status]}</span>
                </span>
                <span className="min-w-0 text-right text-xs text-muted-foreground">
                  <UsageTime value={row.created_at} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {rows.some(row => row.desktop_purpose === 'other_auxiliary') && (
        <p className="mt-3 text-xs text-muted-foreground">{history.unclassifiedHelp}</p>
      )}
      {truncated && <p className="mt-3 text-xs text-muted-foreground">{copy.truncated}</p>}
    </div>
  )
}
