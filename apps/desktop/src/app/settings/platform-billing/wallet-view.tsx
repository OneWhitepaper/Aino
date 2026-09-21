import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import { CreditCard, RefreshCw } from '@/lib/icons'

import { ListRow, SettingsGroup, SettingsSection } from '../primitives'

import { BillingHistory } from './billing-history'
import { PlatformDevices } from './devices-view'
import { RechargeView } from './recharge-view'
import { formatUsageAmount } from './usage-view'
import { useWallet } from './use-wallet'

export function PlatformWallet() {
  const { t, locale } = useI18n()
  const copy = t.platformWallet
  const { available, wallet, loading, error, refresh, scope } = useWallet()
  const [recharge, setRecharge] = useState<{ scope: string; orderId?: string } | null>(null)
  const scopeKey = scope ? `${scope.origin}:${scope.user_id}:${scope.generation}` : ''

  if (!available) {
    return null
  }

  return (
    <div className="mt-8 min-w-0">
      <SettingsSection
        aside={
          <Button disabled={loading} onClick={refresh} size="sm" variant="ghost">
            <RefreshCw />
            {copy.refresh}
          </Button>
        }
        icon={CreditCard}
        title={copy.title}
      >
        {loading && !wallet && <Loader />}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {t.settings.account.platformError(error)}
          </p>
        )}
        {wallet && (
          <>
            <SettingsGroup>
              <div className="py-3" data-settings-row="">
                <p className="text-xs text-muted-foreground">{copy.available}</p>
                <p className="mt-1 text-2xl font-medium tabular-nums [overflow-wrap:anywhere]">
                  {formatUsageAmount(wallet.available_balance)} {wallet.currency}
                </p>
              </div>
              <ListRow
                action={
                  <span className="tabular-nums [overflow-wrap:anywhere]">
                    {formatUsageAmount(wallet.frozen_balance)} {wallet.currency}
                  </span>
                }
                title={copy.frozen}
              />
            </SettingsGroup>
            {!wallet.payment_enabled && <p className="mt-2 text-xs text-muted-foreground">{copy.paymentDisabled}</p>}
            {scope && (
              <div className="mt-4">
                <Button
                  onClick={() => {
                    setRecharge({ scope: scopeKey })
                  }}
                  size="sm"
                  variant="outline"
                >
                  <CreditCard />
                  {t.platformRecharge.title}
                </Button>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {copy.updated}: {new Date(wallet.updated_at).toLocaleString(locale)}
            </p>
          </>
        )}
      </SettingsSection>
      {wallet && (
        <SettingsSection icon={CreditCard} title={copy.subscriptions}>
          {wallet.active_subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.noSubscriptions}</p>
          ) : (
            <SettingsGroup role="list">
              {wallet.active_subscriptions.map(subscription => (
                <div className="min-w-0 py-3" data-settings-row="" key={subscription.id} role="listitem">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{subscription.name}</span>
                    <span className="tabular-nums [overflow-wrap:anywhere]">
                      {subscription.remaining === null
                        ? copy.unlimited
                        : `${formatUsageAmount(subscription.remaining)} ${subscription.unit}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy.expires}: {new Date(subscription.expires_at).toLocaleDateString(locale)}
                  </p>
                </div>
              ))}
            </SettingsGroup>
          )}
        </SettingsSection>
      )}
      {scope && window.hermesDesktop?.platformBilling && (
        <>
          <BillingHistory
            bridge={window.hermesDesktop.platformBilling}
            key={`history:${scope.origin}:${scope.user_id}:${scope.generation}`}
            onOpenOrder={id => {
              setRecharge({ scope: scopeKey, orderId: id })
            }}
            scope={scope}
          />
          <RechargeView
            bridge={window.hermesDesktop.platformBilling}
            key={`${scope.origin}:${scope.user_id}:${scope.generation}`}
            onCredited={refresh}
            onOpenChange={open => {
              setRecharge(open ? { scope: scopeKey, orderId: recharge?.orderId } : null)

              if (!open) {
                refresh()
              }
            }}
            open={recharge?.scope === scopeKey}
            orderId={recharge?.scope === scopeKey ? recharge.orderId : undefined}
            scope={scope}
          />
          {window.hermesDesktop.platformDevices && <PlatformDevices scope={scope} />}
        </>
      )}
    </div>
  )
}
