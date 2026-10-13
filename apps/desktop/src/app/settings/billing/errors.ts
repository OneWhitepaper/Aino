import { runtimeTranslations } from '@/i18n/runtime'

import type { BillingRefusal } from './api'
import type { BillingCopy } from './use-billing-state'

export interface BillingRefusalPresentation {
  action: { type: 'none' } | { type: 'portal'; url?: string } | { type: 'retry' } | { type: 'step_up' }
  message: string
  title: string
}

const portalAction = (url?: string): BillingRefusalPresentation['action'] => ({ type: 'portal', url })

const retryMessage = (refusal: BillingRefusal, copy: BillingCopy): string => {
  const mins = refusal.retryAfter ? Math.max(1, Math.round(refusal.retryAfter / 60)) : undefined

  return copy.refusal.tooManyMessage(mins)
}

const stripeRetryMessage = (refusal: BillingRefusal, copy: BillingCopy): string => {
  const mins = refusal.retryAfter ? Math.max(1, Math.round(refusal.retryAfter / 60)) : undefined

  return copy.refusal.stripeMessage(mins)
}

export const resolveRefusal = (
  refusal: BillingRefusal,
  copy: BillingCopy = runtimeTranslations().billing
): BillingRefusalPresentation => {
  switch (refusal.kind) {
    case 'consent_required':
      return {
        action: portalAction(refusal.portalUrl),
        message: copy.refusal.cardConfirmationMessage,
        title: copy.refusal.cardConfirmationTitle
      }

    case 'insufficient_scope':
      return {
        action: { type: 'step_up' },
        message: copy.refusal.remoteApprovalMessage,
        title: copy.refusal.remoteApprovalTitle
      }
    case 'remote_spending_revoked': {
      const who = refusal.actor === 'admin' ? copy.refusal.remoteStoppedByAdmin : copy.refusal.remoteStoppedByYou

      return {
        action: portalAction(refusal.portalUrl),
        message: `${who} ${copy.refusal.reconnectDevice}`,
        title: copy.refusal.remoteStoppedTitle
      }
    }

    case 'session_revoked':
      return {
        action: portalAction(refusal.portalUrl),
        message: copy.refusal.sessionLoggedOutMessage,
        title: copy.refusal.sessionLoggedOutTitle
      }

    case 'cli_billing_disabled':

    case 'remote_spending_disabled':
      return {
        action: portalAction(refusal.portalUrl),
        message: copy.refusal.spendingOffMessage,
        title: copy.refusal.spendingOffTitle
      }

    case 'role_required':
      return {
        action: portalAction(refusal.portalUrl),
        message: copy.refusal.adminRoleMessage,
        title: copy.refusal.adminRoleTitle
      }

    case 'idempotency_conflict':
      return {
        action: { type: 'none' },
        message: copy.refusal.freshTopupMessage,
        title: copy.refusal.freshTopupTitle
      }

    case 'no_payment_method':
      return {
        action: portalAction(refusal.portalUrl),
        message: copy.refusal.noSavedCardMessage,
        title: copy.refusal.noSavedCardTitle
      }

    case 'org_access_denied':
      return {
        action: { type: 'none' },
        message: copy.refusal.orgAccessDeniedMessage,
        title: copy.refusal.orgAccessDeniedTitle
      }
    case 'monthly_cap_exceeded': {
      const remaining = refusal.payload?.remainingUsd

      return {
        action: portalAction(refusal.portalUrl),
        message:
          remaining != null ? copy.refusal.monthlyCapRemaining(String(remaining)) : copy.refusal.monthlyCapReached,
        title: copy.refusal.monthlyCapTitle
      }
    }

    case 'rate_limited':

    case 'temporarily_unavailable':
      return {
        action: { type: 'retry' },
        message: retryMessage(refusal, copy),
        title: copy.refusal.tooManyTitle
      }

    case 'stripe_unavailable':
      return {
        action: { type: 'retry' },
        message: stripeRetryMessage(refusal, copy),
        title: copy.refusal.stripeTitle
      }

    case 'upgrade_cap_exceeded':
      return {
        action: { type: 'none' },
        message: copy.refusal.dailyLimitMessage,
        title: copy.refusal.dailyLimitTitle
      }

    case 'endpoint_unavailable':
      return {
        action: { type: 'retry' },
        message: refusal.message || copy.refusal.endpointUnavailableMessage,
        title: copy.refusal.endpointUnavailableTitle
      }

    case 'timeout':
      return {
        action: { type: 'retry' },
        message: refusal.message || copy.refusal.requestTimedOutMessage,
        title: copy.refusal.requestTimedOutTitle
      }

    case 'transport':
      return {
        action: { type: 'retry' },
        message: refusal.message || copy.refusal.connectionFailedMessage,
        title: copy.refusal.connectionFailedTitle
      }

    default:
      return {
        action: { type: 'none' },
        message: refusal.message || copy.refusal.requestFailedMessage,
        title: copy.refusal.requestFailedTitle
      }
  }
}
