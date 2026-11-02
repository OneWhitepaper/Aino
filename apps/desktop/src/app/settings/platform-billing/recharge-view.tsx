import './account-wallet.css'

import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { ExternalLink, RefreshCw } from '@/lib/icons'

import type { PaymentQuote, PlatformBillingBridge, PlatformBillingScope } from '../../../../shared/platform-contract'

import { PaymentQr } from './payment-qr'
import { finalRechargeQuote, liveRechargeCheckout } from './recharge-order-state'
import { formatUsageAmount } from './usage-view'
import { useCheckoutExpiry } from './use-checkout-expiry'
import { useRecharge } from './use-recharge'

interface RechargeViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bridge: PlatformBillingBridge
  scope: PlatformBillingScope
  orderId?: string
  onCredited?: () => void
}

const ERROR_MESSAGES: Record<string, string> = {
  platform_account_changed: 'account',
  auth_attempt_superseded: 'account',
  not_authenticated: 'account',
  reauthentication_required: 'account',
  INVALID_AMOUNT: 'amount',
  invalid_amount: 'amount',
  IDEMPOTENCY_KEY_CONFLICT: 'conflict',
  payment_recovery_unavailable: 'recovery',
  PAYMENT_DISABLED: 'disabled',
  BALANCE_PAYMENT_DISABLED: 'disabled',
  authentication_refreshed_retry_required: 'retry'
}

export function RechargeView({ open, onOpenChange, bridge, scope, orderId, onCredited }: RechargeViewProps) {
  const { t } = useI18n()
  const copy = t.platformRecharge
  const flow = useRecharge(bridge, scope, open, orderId)
  const [amount, setAmount] = useState('')
  const [selected, setSelected] = useState<'alipay' | 'wxpay' | null>(null)
  const amountId = useId()
  const methods = flow.info?.methods.filter(method => method.available) ?? []
  const method = methods.find(method => method.id === selected) ?? methods[0]
  const allowed = Boolean(flow.info?.payment_enabled && !flow.info.balance_disabled && method)
  const input = { amount, payment_type: method?.id ?? ('alipay' as const), order_type: 'balance' as const }
  const order = flow.order
  const methodId = method?.id
  const validAmount = /^\d{1,12}(\.\d{1,8})?$/.test(amount) && /[1-9]/.test(amount)
  const showForm = !order && (!flow.intent || flow.intent.rejected)
  const { quoteInput } = flow
  const notified = useRef(new Set<string>())

  useEffect(() => {
    if (!open || !allowed || !showForm || !validAmount || !methodId || flow.error) {
      return
    }

    const controller = new AbortController()

    const timer = setTimeout(() => {
      void quoteInput({ amount, payment_type: methodId, order_type: 'balance' }, controller.signal)
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [allowed, amount, flow.error, methodId, open, quoteInput, showForm, validAmount])

  const creditedOrder =
    open && flow.credited && order ? `${scope.origin}:${scope.user_id}:${scope.generation}:${order.order_id}` : null

  useEffect(() => {
    if (creditedOrder && !notified.current.has(creditedOrder)) {
      notified.current.add(creditedOrder)
      onCredited?.()
    }
  }, [creditedOrder, onCredited])

  const checkoutExpired = useCheckoutExpiry(
    Math.min(Date.parse(order?.expires_at ?? ''), Date.parse(order?.checkout?.expires_at ?? '')),
    open && order?.status === 'PENDING'
  )

  const checkoutLive = liveRechargeCheckout(order, checkoutExpired)
  const finalQuote = finalRechargeQuote(order)

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent bodyClassName="account-recharge-dialog-body" className="account-recharge-dialog">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {flow.error && (
          <p className="text-sm text-destructive" role="alert">
            {t.platformRechargeErrors[ERROR_MESSAGES[flow.error]] ?? copy.error}
          </p>
        )}
        {flow.error && showForm && (
          <Button disabled={flow.busy} onClick={flow.refresh} size="sm" variant="outline">
            <RefreshCw />
            {t.common.retry}
          </Button>
        )}
        {flow.busy && !flow.info && !order && <Loader />}
        {order ? (
          <div className="account-recharge-order grid min-w-0 gap-4">
            <p className="account-recharge-status" data-status={order.status} role="status">
              {order.status === 'COMPLETED'
                ? flow.credited
                  ? copy.success
                  : copy.confirmingBalance
                : copy.status[order.status]}
            </p>
            <dl className="account-recharge-quote grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{copy.orderId}</dt>
              <dd className="text-right [overflow-wrap:anywhere]">{order.out_trade_no}</dd>
              <dt className="text-muted-foreground">{copy.payAmount}</dt>
              <dd className="text-right tabular-nums">
                {formatUsageAmount(order.pay_amount)} {order.payment_currency}
              </dd>
              <dt className="text-muted-foreground">{copy.creditAmount}</dt>
              <dd className="text-right tabular-nums">
                {formatUsageAmount(order.credit_amount)} {order.credit_currency}
              </dd>
            </dl>
            {order.confirmation_required && finalQuote && (
              <>
                <p className="text-sm text-muted-foreground">{copy.changedQuote}</p>
                <QuoteDetails quote={finalQuote} />
                <Button
                  disabled={flow.busy}
                  onClick={() =>
                    void flow.submit(
                      {
                        amount: finalQuote.requested_amount,
                        payment_type: order.payment_type as 'alipay' | 'wxpay',
                        order_type: 'balance'
                      },
                      finalQuote
                    )
                  }
                >
                  {copy.confirmPrice}
                </Button>
              </>
            )}
            {order.payment_unknown && <p className="text-sm text-muted-foreground">{copy.unknown}</p>}
            {order.status === 'PENDING' && order.checkout && checkoutExpired && (
              <p className="text-sm text-muted-foreground">{t.platformRechargeErrors.expired}</p>
            )}
            {checkoutLive && order.checkout?.qr_code && <PaymentQr payload={order.checkout.qr_code} />}
            {checkoutLive && order.checkout?.pay_url && (
              <Button disabled={flow.busy} onClick={() => void flow.openCheckout()}>
                <ExternalLink />
                {copy.openPayment}
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={flow.busy} onClick={flow.refresh} size="sm" variant="outline">
                <RefreshCw />
                {copy.refresh}
              </Button>
              {order.can_cancel && (
                <Button disabled={flow.busy} onClick={() => void flow.cancel()} size="sm" variant="ghost">
                  {copy.cancelOrder}
                </Button>
              )}
              {['EXPIRED', 'CANCELLED', 'FAILED', 'REFUNDED'].includes(order.status) || flow.credited ? (
                <Button disabled={flow.busy} onClick={() => void flow.startNew()} size="sm" variant="ghost">
                  {copy.newOrder}
                </Button>
              ) : null}
            </div>
          </div>
        ) : flow.intent && !flow.intent.rejected ? (
          <div className="grid gap-4">
            <p className="text-sm">{copy.unknown}</p>
            <Button disabled={flow.busy} onClick={() => void flow.submit(flow.intent!)}>
              {copy.resume}
            </Button>
          </div>
        ) : flow.info ? (
          allowed ? (
            <form
              className="account-recharge-form grid gap-4"
              onSubmit={event => {
                event.preventDefault()

                if (flow.quote && !flow.busy && !flow.quoting) {
                  void flow.submit(input, flow.quote)
                }
              }}
            >
              <label className="grid gap-2 text-sm" htmlFor={amountId}>
                {copy.amount}
                <Input
                  autoComplete="off"
                  disabled={flow.busy}
                  id={amountId}
                  inputMode="decimal"
                  onChange={event => {
                    setAmount(event.target.value)
                    flow.clearQuote()
                  }}
                  value={amount}
                />
              </label>
              <SegmentedControl
                className="account-recharge-methods"
                disabled={flow.busy}
                onChange={id => {
                  if (id === methodId) {
                    return
                  }

                  setSelected(id)
                  flow.clearQuote()
                }}
                options={methods.map(item => ({ id: item.id, label: item.display_name || copy.methods[item.id] }))}
                value={method.id}
              />
              <p className="text-xs text-muted-foreground">
                {copy.range}: {formatUsageAmount(method.min_amount)}
                {/[1-9]/.test(method.max_amount) ? ` - ${formatUsageAmount(method.max_amount)}` : '+'} {method.currency}
              </p>
              {flow.quote && <QuoteDetails quote={flow.quote} />}
              {validAmount && !flow.quote && !flow.error && (
                <p className="text-xs text-muted-foreground" role="status">
                  {copy.quote}
                </p>
              )}
              <DialogFooter>
                <Button disabled={flow.busy} onClick={() => onOpenChange(false)} type="button" variant="outline">
                  {t.common.cancel}
                </Button>
                <Button disabled={flow.busy || flow.quoting || !flow.quote} type="submit">
                  {copy.create}
                </Button>
              </DialogFooter>
              {flow.info.help_text && (
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">{flow.info.help_text}</p>
              )}
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{copy.unavailable}</p>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function QuoteDetails({ quote }: { quote: PaymentQuote }) {
  const { t } = useI18n()
  const copy = t.platformRecharge

  return (
    <dl className="account-recharge-quote grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{copy.payAmount}</dt>
      <dd className="text-right tabular-nums [overflow-wrap:anywhere]">
        {formatUsageAmount(quote.pay_amount)} {quote.payment_currency}
      </dd>
      <dt className="text-muted-foreground">{copy.fee}</dt>
      <dd className="text-right tabular-nums [overflow-wrap:anywhere]">
        {formatUsageAmount(quote.fee_amount)} {quote.payment_currency}
      </dd>
      <dt className="text-muted-foreground">{copy.creditAmount}</dt>
      <dd className="text-right tabular-nums [overflow-wrap:anywhere]">
        {formatUsageAmount(quote.credit_amount)} {quote.credit_currency}
      </dd>
    </dl>
  )
}
