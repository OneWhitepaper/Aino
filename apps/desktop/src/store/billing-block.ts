import type { BillingBlock } from '@hermes/shared'
import { atom } from 'nanostores'

import { FALLBACK_PORTAL_BILLING_URL } from '@/app/settings/billing/use-billing-state'
import { openExternalLink } from '@/lib/external-link'
import { setModelPickerOpen } from '@/store/session'

/**
 * The active inference billing wall, if any. Set from the gateway
 * `message.complete` / `error` event when a turn fails with
 * `FailoverReason.billing` (see `agent/billing_links.py`). One global slot: a
 * credit wall on the active session's provider is the whole app's problem, and
 * the newest block wins. Cleared when a new turn starts or the user dismisses.
 */
export interface ActiveBillingBlock {
  block: BillingBlock
  sessionId: string
  at: number
}

export const $billingBlock = atom<ActiveBillingBlock | null>(null)

/** Nous service billing remains a separate provider destination from the Aino account. */
export function requestBillingSettings(): void {
  openExternalLink(FALLBACK_PORTAL_BILLING_URL)
}

export function setBillingBlock(sessionId: string, block: BillingBlock): void {
  $billingBlock.set({ at: Date.now(), block, sessionId })
}

export function clearBillingBlock(sessionId?: string): void {
  const current = $billingBlock.get()

  if (!current) {
    return
  }

  // A scoped clear (new turn on session X) must not wipe a block raised by a
  // different session's provider.
  if (sessionId && current.sessionId !== sessionId) {
    return
  }

  $billingBlock.set(null)
}

/**
 * Both billing surfaces use the same recovery: provider-specific payment links
 * stay external; managed or unlinked providers return to model selection.
 */
export function runBillingRecovery(block: BillingBlock): void {
  if (block.is_nous) {
    requestBillingSettings()

    return
  }

  if (block.billing_url) {
    openExternalLink(block.billing_url)

    return
  }

  setModelPickerOpen(true)
}

export function billingCtaLabel(block: BillingBlock, copy: { addCredits: string; chooseModel: string }): string {
  return !block.is_nous && block.billing_url ? copy.addCredits : copy.chooseModel
}
