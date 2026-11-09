import { useStore } from '@nanostores/react'

import { StatusRow } from '@/components/chat/status-row'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { $billingBlock, billingCtaLabel, clearBillingBlock, runBillingRecovery } from '@/store/billing-block'
import { recordFriction } from '@/store/desktop-metrics'

function firstLine(text: string): string {
  return (text || '').split('\n')[0]?.trim() ?? ''
}

/**
 * Persistent, in-stack billing wall for THIS session. Rendered as a shared
 * {@link StatusRow} — same chrome as its status-stack siblings, so it reads as
 * one piece with the composer card (no bordered alert-in-a-card). It never
 * disables the composer — slash commands (`/topup`, `/model`, `/login`) stay
 * usable — provider-specific payment links open externally, while managed
 * providers return to model selection. The sticky toast is the loud surface;
 * this is the calm reminder that outlives it.
 */
export function BillingBanner({ sessionId }: { sessionId: null | string }) {
  const active = useStore($billingBlock)
  const { t } = useI18n()

  if (!active || !sessionId || active.sessionId !== sessionId) {
    return null
  }

  const { block } = active
  const copy = t.billingBlock
  const title = block.is_nous ? copy.titleNous : copy.titleProvider(block.provider_label)
  const message = firstLine(block.message) || copy.fallbackMessage

  return (
    <StatusRow leading={<Codicon aria-hidden className="text-destructive/85" name="credit-card" size="0.8rem" />}>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 py-1">
        <p className="min-w-0 text-sm leading-5 text-foreground [overflow-wrap:anywhere]">
          <span className="font-medium">{title}</span>
          {message && <span className="text-[0.8125rem] text-(--ui-text-secondary)"> · {message}</span>}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Button
            className="min-h-7 max-w-full whitespace-normal text-left text-[0.8125rem] text-foreground hover:text-foreground [overflow-wrap:anywhere]"
            onClick={() => runBillingRecovery(block)}
            size="micro"
            type="button"
            variant="text"
          >
            {billingCtaLabel(block, { addCredits: copy.addCredits, chooseModel: t.desktop.chooseModel })}
          </Button>
          <Button
            aria-label={copy.dismiss}
            className="size-7 rounded-md text-(--ui-text-secondary) hover:text-foreground"
            onClick={() => {
              recordFriction('notice_dismissed', 'billing_banner')
              clearBillingBlock(sessionId)
            }}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon aria-hidden name="close" size="0.85rem" />
          </Button>
        </div>
      </div>
    </StatusRow>
  )
}
