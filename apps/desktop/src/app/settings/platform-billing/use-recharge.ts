import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  PaymentQuote,
  PaymentQuoteInput,
  PlatformBillingBridge,
  PlatformBillingScope,
  PlatformCheckoutInfo,
  PlatformOrder
} from '../../../../shared/platform-contract'

import { createRechargeIntents, type RechargeIntent } from './recharge-intent'
import { type OrderRefresh, paymentErrorCode, POLLING_ORDERS, useOrderStatus } from './use-order-status'

interface RechargeState {
  key: string
  info: PlatformCheckoutInfo | null
  intent: RechargeIntent | null
  quote: PaymentQuote | null
  order: PlatformOrder | null
  busy: boolean
  quoting: boolean
  error: string | null
  credited: boolean
}

const blank: RechargeState = {
  key: '',
  info: null,
  intent: null,
  quote: null,
  order: null,
  busy: false,
  quoting: false,
  error: null,
  credited: false
}

const FINISHED = new Set(['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'REFUNDED'])

export function useRecharge(
  bridge: PlatformBillingBridge,
  scope: PlatformBillingScope,
  open: boolean,
  initialOrderId?: string
) {
  const accountKey = JSON.stringify([scope.origin, scope.user_id, scope.generation])
  const key = JSON.stringify([accountKey, initialOrderId ?? null])
  const [state, setState] = useState<RechargeState>(blank)
  const [retry, setRetry] = useState(0)
  const [initialRetry, setInitialRetry] = useState(0)
  const lifecycle = useRef({ generation: 0 })
  const inflight = useRef(false)
  const operation = useRef(0)
  const quoteRequest = useRef(0)
  const visible = state.key === key ? state : blank
  const owner = scope.user_id
  const origin = scope.origin
  const authGeneration = scope.generation

  const verify = useCallback(async () => {
    const current = await bridge.scope({ expected_user_id: owner })

    if (JSON.stringify([current.origin, current.user_id, current.generation]) !== accountKey) {
      throw Object.assign(new Error('platform_account_changed'), { code: 'platform_account_changed' })
    }
  }, [accountKey, bridge, owner])

  useEffect(() => {
    const lifetime = lifecycle.current
    const generation = ++lifetime.generation

    if (!open) {
      return
    }

    let stopped = false
    const intents = createRechargeIntents({ origin, user_id: owner, generation: authGeneration })

    void (async () => {
      setState({ ...blank, key, busy: true })

      try {
        await verify()
        let intent: RechargeIntent | null = null

        try {
          intent = await intents.read()
        } catch (error) {
          // Server-owned history remains readable when local recovery cannot be read.
          if (!initialOrderId) {
            throw error
          }
        }

        const id = initialOrderId ?? intent?.order_id
        const order = id ? await bridge.getOrder({ expected_user_id: owner, order_id: id }) : null
        const info = order ? null : await bridge.checkoutInfo({ expected_user_id: owner })
        await verify()
        let error: string | null = null

        if (!stopped && initialOrderId && intent && order?.client_order_id === intent.client_order_id) {
          try {
            intent = await intents.rememberOrder(intent.client_order_id, order.order_id)
          } catch (failure) {
            // Storage failure must not hide the authoritative history order.
            error = paymentErrorCode(failure)
          }

          await verify()
        }

        if (!stopped) {
          setState({ ...blank, key, info, intent, order, error })
        }
      } catch (error) {
        if (!stopped) {
          setState(previous => ({ ...previous, key, busy: false, error: paymentErrorCode(error) }))
        }
      }
    })()

    return () => {
      stopped = true

      if (lifetime.generation === generation) {
        ++lifetime.generation
      }
    }
  }, [authGeneration, bridge, initialOrderId, initialRetry, key, open, origin, owner, verify])

  const refreshOrder = useCallback(
    async (orderId: string) => {
      await verify()
      const order = await bridge.getOrder({ expected_user_id: owner, order_id: orderId })
      let credited = false
      let error: string | null = null

      if (order.status === 'COMPLETED') {
        try {
          await bridge.summary({ expected_user_id: owner })
          credited = true
        } catch (failure) {
          error = paymentErrorCode(failure)
        }
      }

      await verify()

      return { order, credited, error }
    },
    [bridge, owner, verify]
  )

  const applyOrder = useCallback(
    (value: Partial<OrderRefresh>) => {
      setState(previous => (previous.key === key ? { ...previous, ...value } : previous))
    },
    [key]
  )

  useOrderStatus({
    enabled: open && !visible.busy,
    order: visible.order,
    credited: visible.credited,
    retry,
    operation,
    read: refreshOrder,
    apply: applyOrder
  })

  const quoteInput = useCallback(
    async (input: PaymentQuoteInput, signal: AbortSignal) => {
      if (!open || signal.aborted || inflight.current) {
        return
      }

      const request = ++quoteRequest.current
      const generation = lifecycle.current.generation

      const current = () =>
        !signal.aborted && request === quoteRequest.current && generation === lifecycle.current.generation

      setState(previous => ({ ...previous, quote: null, quoting: true, error: null }))

      try {
        await verify()

        if (!current()) {
          return
        }

        const quote = await bridge.quote({ ...input, expected_user_id: owner })
        await verify()

        if (current()) {
          setState(previous => ({ ...previous, quote, quoting: false }))
        }
      } catch (error) {
        if (current()) {
          setState(previous => ({ ...previous, quoting: false, error: paymentErrorCode(error) }))
        }
      }
    },
    [bridge, open, owner, verify]
  )

  const clearQuote = useCallback(() => {
    ++quoteRequest.current
    setState(previous => ({ ...previous, quote: null, quoting: false, error: null }))
  }, [])

  const action = async (run: () => Promise<Partial<RechargeState>>) => {
    if (inflight.current || !open) {
      return
    }

    inflight.current = true
    ++operation.current
    const generation = lifecycle.current.generation
    setState(previous => ({ ...previous, key, busy: true, error: null }))

    try {
      await verify()
      const patch = await run()
      await verify()

      if (generation === lifecycle.current.generation) {
        setState(previous => ({ ...previous, ...patch, busy: false }))
      }
    } catch (error) {
      if (generation === lifecycle.current.generation) {
        setState(previous => ({ ...previous, busy: false, error: paymentErrorCode(error) }))
      }
    } finally {
      inflight.current = false
    }
  }

  const submit = (input: PaymentQuoteInput, quote?: PaymentQuote) =>
    action(async () => {
      const generation = lifecycle.current.generation
      const intents = createRechargeIntents(scope)

      if (visible.order?.confirmation_required && visible.order.client_order_id && quote) {
        const order = await bridge.createOrder({
          ...input,
          client_order_id: visible.order.client_order_id,
          expected_quote: quote,
          expected_user_id: owner
        })

        return { order, quote: null, credited: false }
      }

      const intent = await intents.begin(input, quote && visible.intent?.rejected ? visible.intent : undefined)
      await verify()

      if (generation !== lifecycle.current.generation) {
        return {}
      }

      setState(previous => ({ ...previous, intent }))

      if (intent.order_id && !visible.order?.confirmation_required) {
        return { intent, ...(await refreshOrder(intent.order_id)), quote: null }
      }

      if (
        intent.rejected ||
        (quote && (intent.amount !== input.amount || intent.payment_type !== input.payment_type))
      ) {
        return { intent, quote: null }
      }

      // Only an explicit click dispatches a mutation. Unknown-result retries keep the UUID.
      let order: PlatformOrder

      try {
        order = await bridge.createOrder({
          amount: intent.amount,
          payment_type: intent.payment_type,
          order_type: 'balance',
          client_order_id: intent.client_order_id,
          ...(quote ? { expected_quote: quote } : {}),
          expected_user_id: owner
        })
      } catch (error) {
        if (paymentErrorCode(error) !== 'INVALID_AMOUNT') {
          throw error
        }

        const rejected = await intents.reject(intent)

        return { intent: rejected, quote: null, error: 'INVALID_AMOUNT' }
      }

      await intents.rememberOrder(intent.client_order_id, order.order_id)

      return { intent: { ...intent, order_id: order.order_id }, order, quote: null, credited: false }
    })

  return {
    ...visible,
    quoteInput,
    clearQuote,
    submit,
    refresh: () => {
      if (visible.order) {
        if (POLLING_ORDERS.has(visible.order.status)) {
          setRetry(value => value + 1)
        } else {
          void action(async () => refreshOrder(visible.order!.order_id))
        }
      } else {
        setInitialRetry(value => value + 1)
      }
    },
    cancel: () =>
      action(async () =>
        visible.order
          ? {
              order: await bridge.cancelOrder({ expected_user_id: owner, order_id: visible.order.order_id }),
              credited: false
            }
          : {}
      ),
    openCheckout: () =>
      action(async () => {
        if (visible.order) {
          await bridge.openCheckout({ expected_user_id: owner, order_id: visible.order.order_id })
        }

        return {}
      }),
    startNew: () =>
      action(async () => {
        if (
          !visible.order ||
          !FINISHED.has(visible.order.status) ||
          (visible.order.status === 'COMPLETED' && !visible.credited)
        ) {
          return {}
        }

        if (visible.intent && visible.intent.order_id === visible.order.order_id) {
          await createRechargeIntents(scope).finish(visible.intent.client_order_id)
        }

        return {
          intent: null,
          order: null,
          quote: null,
          credited: false,
          info: await bridge.checkoutInfo({ expected_user_id: owner })
        }
      })
  }
}
