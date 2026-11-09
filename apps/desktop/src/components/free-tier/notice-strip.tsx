import { useStore } from '@nanostores/react'
import { useEffect, useId } from 'react'

import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { StatusRow } from '@/components/chat/status-row'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { recordFriction } from '@/store/desktop-metrics'
import { ackFreeTierNotice, claimFreeTierNotice, freeTierNoticeClaim, releaseFreeTierNotice } from '@/store/free-tier'
import { openFreeTierSignIn } from '@/store/free-tier-sign-in'
import { setModelPickerOpen } from '@/store/session'

/**
 * Which mounted composer gets to paint the strip. Several can be on screen at
 * once (split zones, a popout mid-dock); the first to mount claims it and the
 * rest report false, so one pending notice never paints N times. The CALLER
 * asks, so a non-owning stack adds no empty row to its card.
 */
export function useFreeTierNoticeOwner(): boolean {
  const id = useId()
  const claim = useStore(freeTierNoticeClaim())

  useEffect(() => {
    claimFreeTierNotice(id)

    return () => releaseFreeTierNotice(id)
  }, [id])

  // When the owner unmounts it releases the claim; a composer still mounted takes it over,
  // so the notice does not vanish until some later mount.
  useEffect(() => {
    if (claim === null) {
      claimFreeTierNotice(id)
    }
  }, [claim, id])

  return claim === id
}

/**
 * The quiet half of the free-tier introduction: shown when the user already has
 * a provider of their own carrying inference, so the free models are an offer
 * rather than the only road. It lives in the composer status stack — the same
 * lane as the billing wall — and never blocks the composer.
 *
 * Backend-latched: `notice_pending` is the only source of truth, so any of the
 * three actions retires it everywhere at once and no renderer flag can strand a
 * strip the backend considers seen.
 */
export function FreeTierNoticeStrip() {
  const { requestGateway } = useGatewayRequest()
  const { t } = useI18n()
  const copy = t.freeTier

  const consume = (after?: () => void) => {
    void ackFreeTierNotice(requestGateway)
    after?.()
  }

  return (
    <StatusRow leading={<Codicon aria-hidden className="text-(--ui-text-tertiary)" name="account" size="0.8rem" />}>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 py-1">
        <p className="min-w-0 text-sm leading-5 text-foreground [overflow-wrap:anywhere]">
          <span className="font-medium">{copy.stripTitle}</span>
          <span className="text-[0.8125rem] text-(--ui-text-secondary)"> {copy.stripBody}</span>
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Button
            className="min-h-7 max-w-full whitespace-normal text-left text-[0.8125rem] text-foreground hover:text-foreground [overflow-wrap:anywhere]"
            onClick={() => consume(() => setModelPickerOpen(true))}
            size="micro"
            type="button"
            variant="text"
          >
            {copy.openModelPicker}
          </Button>
          <Button
            className="min-h-7 max-w-full whitespace-normal text-left text-[0.8125rem] text-foreground hover:text-foreground [overflow-wrap:anywhere]"
            onClick={() => consume(() => openFreeTierSignIn())}
            size="micro"
            type="button"
            variant="text"
          >
            {copy.signIn}
          </Button>
          <Button
            className="min-h-7 max-w-full whitespace-normal text-left text-[0.8125rem] text-(--ui-text-secondary) hover:text-foreground [overflow-wrap:anywhere]"
            onClick={() => {
              recordFriction('notice_dismissed', 'free_tier_notice')
              consume()
            }}
            size="micro"
            type="button"
            variant="text"
          >
            {copy.dismiss}
          </Button>
        </div>
      </div>
    </StatusRow>
  )
}
