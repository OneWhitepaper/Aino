import './account-wallet.css'

import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { ChevronRight, CreditCard, Plus, RefreshCw } from '@/lib/icons'

import { ListRowSkeleton, SettingsGroup } from '../primitives'

import { BillingHistory } from './billing-history'
import { PlatformDevices } from './devices-view'
import { RechargeView } from './recharge-view'
import { formatUsageAmount } from './usage-view'
import { useWallet } from './use-wallet'
import { compactWalletBalance } from './wallet-balance'
import { WalletSubscriptions } from './wallet-subscriptions'

export function PlatformWallet() {
  const { t, locale } = useI18n()
  const copy = t.platformWallet
  const page = t.accountPage
  const { available, wallet, loading, error, refresh, scope } = useWallet()
  const [recharge, setRecharge] = useState<{ scope: string; orderId?: string } | null>(null)
  const scopeKey = scope ? `${scope.origin}:${scope.user_id}:${scope.generation}` : ''
  const initialLoading = loading && !wallet
  const id = useId()
  const exactBalance = wallet ? formatUsageAmount(wallet.available_balance) : ''
  const compactBalance = wallet ? compactWalletBalance(wallet.available_balance) : ''

  if (!available) {
    return null
  }

  return (
    <div className="account-wallet">
      <div className="account-wallet-overview">
        <SettingsGroup aria-labelledby={`${id}-wallet`} className="account-wallet-card" role="region">
          <div className="account-wallet-heading">
            <h2 id={`${id}-wallet`}>
              <CreditCard aria-hidden="true" />
              {copy.title}
            </h2>
            <Button aria-label={copy.refresh} disabled={loading} onClick={refresh} size="icon-sm" variant="ghost">
              <RefreshCw />
            </Button>
          </div>
          {initialLoading && (
            <div aria-busy aria-label={t.common.loading} className="account-wallet-loading" role="status">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-44 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          )}
          {error && (
            <p className="account-wallet-error" role="alert">
              {t.settings.account.platformError(error)}
            </p>
          )}
          {wallet && (
            <>
              <div className="account-wallet-balance-row">
                <div className="account-wallet-balance-copy">
                  <p className="account-wallet-label">{copy.available}</p>
                  <p className="account-wallet-balance">
                    <span>{compactBalance}</span> <span className="account-wallet-currency">{wallet.currency}</span>
                  </p>
                  {compactBalance !== exactBalance && (
                    <details className="account-wallet-precision">
                      <summary>
                        <ChevronRight aria-hidden="true" />
                        {page.exactBalance}
                      </summary>
                      <p>
                        {exactBalance} {wallet.currency}
                      </p>
                    </details>
                  )}
                </div>
                {scope && (
                  <Button onClick={() => setRecharge({ scope: scopeKey })} size="sm">
                    <Plus />
                    {t.platformRecharge.title}
                  </Button>
                )}
              </div>
              <div className="account-wallet-footer">
                <span>
                  {copy.frozen}{' '}
                  <span className="account-wallet-number">
                    {formatUsageAmount(wallet.frozen_balance)} {wallet.currency}
                  </span>
                </span>
                <span>
                  {copy.updated}: {new Date(wallet.updated_at).toLocaleString(locale)}
                </span>
              </div>
              {!wallet.payment_enabled && <p className="account-wallet-payment-notice">{copy.paymentDisabled}</p>}
            </>
          )}
        </SettingsGroup>
        <WalletSubscriptions id={id} initialLoading={initialLoading} wallet={wallet} />
      </div>
      {initialLoading && !scope && window.hermesDesktop?.platformBilling && (
        <div aria-busy aria-label={t.common.loading} className="account-wallet-history-loading" role="status">
          <Skeleton className="h-8 w-44 max-w-full" />
          {window.hermesDesktop.platformDevices && <ListRowSkeleton />}
        </div>
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
