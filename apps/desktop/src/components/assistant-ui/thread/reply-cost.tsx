import type { ReactNode } from 'react'

import { formatUsageAmount, UsageView } from '@/app/settings/platform-billing/usage-view'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import type { TurnBilling } from '@/lib/turn-billing'

import { useTurnCost } from './use-turn-cost'

interface ReplyCostProps {
  billing: TurnBilling
  children?: ReactNode
  entryLabel?: string
}

export function ReplyCost({ billing, children, entryLabel }: ReplyCostProps) {
  const { t } = useI18n()
  const { cost, available, needsLogin, exhausted, retry, rows, truncated } = useTurnCost(billing)
  const copy = t.platformUsage
  const amount = cost.amount === null ? undefined : formatUsageAmount(cost.amount)

  const label = !available
    ? needsLogin
      ? copy.signIn
      : copy.unavailable
    : cost.status === 'settled'
      ? copy.settled
      : cost.status === 'partial'
        ? copy.partial
        : exhausted
          ? copy.unverified
          : copy.pending

  const dialog = (
    <Dialog key={`${billing.user_id}:${billing.session_id}:${billing.turn_id}`}>
      <DialogTrigger asChild>
        <Button className="text-[length:var(--aino-text-caption)] font-normal" size="inline" variant="link">
          {entryLabel || copy.details}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entryLabel || copy.details}</DialogTitle>
          <DialogDescription>
            {label}
            {amount !== undefined ? ` ${amount} USD` : ''}
          </DialogDescription>
        </DialogHeader>
        {children}
        {available && <UsageView rows={rows} truncated={truncated} />}
        {exhausted && (
          <Button onClick={retry} size="sm" variant="secondary">
            {copy.retry}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )

  // Keep the ledger hook mounted when details are closed, including its cache,
  // bounded checks and account-switch invalidation.
  if (entryLabel) {
    return <div data-slot="aui_reply-metrics">{dialog}</div>
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[length:var(--aino-text-caption)] text-muted-foreground tabular-nums">
      <span>
        {label}
        {amount !== undefined ? ` ${amount} USD` : ''}
      </span>
      {exhausted && (
        <Button
          className="text-[length:var(--aino-text-caption)] font-normal"
          onClick={retry}
          size="inline"
          variant="link"
        >
          {copy.retry}
        </Button>
      )}
      {available && dialog}
    </div>
  )
}
