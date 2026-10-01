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
}

export function ReplyCost({ billing }: ReplyCostProps) {
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

  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
      <span>
        {label}
        {amount !== undefined ? ` ${amount} USD` : ''}
      </span>
      {exhausted && (
        <Button onClick={retry} size="xs" variant="link">
          {copy.retry}
        </Button>
      )}
      {available && (
        <Dialog key={`${billing.user_id}:${billing.session_id}:${billing.turn_id}`}>
          <DialogTrigger asChild>
            <Button size="xs" variant="link">
              {copy.details}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{copy.details}</DialogTitle>
              <DialogDescription>
                {label}
                {amount !== undefined ? ` ${amount} USD` : ''}
              </DialogDescription>
            </DialogHeader>
            <UsageView rows={rows} truncated={truncated} />
            {exhausted && (
              <Button onClick={retry} size="sm" variant="secondary">
                {copy.retry}
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
