import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { Layers3 } from '@/lib/icons'

import type { PlatformWalletSummary } from '../../../../shared/platform-contract'
import { Pill, SettingsGroup } from '../primitives'

import { formatUsageAmount } from './usage-view'

interface WalletSubscriptionsProps {
  wallet: PlatformWalletSummary | null
  initialLoading: boolean
  id: string
}

export function WalletSubscriptions({ wallet, initialLoading, id }: WalletSubscriptionsProps) {
  const { t, locale } = useI18n()
  const copy = t.platformWallet
  const page = t.accountPage

  if (!initialLoading && !wallet) {
    return null
  }

  return (
    <SettingsGroup aria-labelledby={`${id}-subscriptions`} className="account-subscription-card" role="region">
      <div className="account-wallet-heading">
        <h2 id={`${id}-subscriptions`}>
          <Layers3 aria-hidden="true" />
          {copy.subscriptions}
        </h2>
      </div>
      {initialLoading && (
        <div aria-busy aria-label={t.common.loading} className="account-wallet-loading" role="status">
          <Skeleton className="h-4 w-28 max-w-full" />
          <Skeleton className="h-3 w-48 max-w-full" />
        </div>
      )}
      {wallet?.active_subscriptions.length === 0 && (
        <div className="account-subscription-empty">
          <p>{copy.noSubscriptions}</p>
          <p>{page.noSubscriptionsDescription}</p>
        </div>
      )}
      {wallet && wallet.active_subscriptions.length > 0 && (
        <div className="account-subscriptions" role="list">
          {wallet.active_subscriptions.map(subscription => (
            <div className="account-subscription" key={subscription.id} role="listitem">
              <div className="account-subscription-name">
                <span>{subscription.name}</span>
                <Pill tone="success">{page.subscriptionActive}</Pill>
              </div>
              <dl>
                <div>
                  <dt>{page.remaining}</dt>
                  <dd className="account-wallet-number">
                    {subscription.remaining === null
                      ? copy.unlimited
                      : `${formatUsageAmount(subscription.remaining)} ${subscription.unit}`}
                  </dd>
                </div>
                <div>
                  <dt>{copy.expires}</dt>
                  <dd>{new Date(subscription.expires_at).toLocaleDateString(locale)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </SettingsGroup>
  )
}
