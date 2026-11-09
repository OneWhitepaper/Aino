import { JsonRpcGatewayClient, LOCAL_CONNECTION_ID, randomUuid } from '@hermes/shared'

import { getRuntimeI18nLocale } from '@/i18n/runtime'
import { requireBrowserConnection } from '@/lib/browser-connection'
import { type BrowserBootstrap, ticketedWebsocketUrl } from '@/lib/browser-transport'
import { browserLaunchProfileOrDefault } from '@/lib/platform'
import { confirm } from '@/store/confirm'

import { platformBindingPrompt } from '../../electron/platform-binding-prompt'
import { createPlatformAuth } from '../../shared/platform-auth'
import {
  createPlatformClient,
  PLATFORM_PRODUCTION_ORIGIN,
  type PlatformClient,
  PlatformClientError
} from '../../shared/platform-client'
import type {
  PlatformAccountBridge,
  PlatformBillingBridge,
  PlatformDevicesBridge,
  PlatformModelsBridge
} from '../../shared/platform-contract'
import { openPlatformCheckout } from '../../shared/platform-payment'
import { createPlatformRuntimeBindingController } from '../../shared/platform-runtime-binding'

/** Aino identity is separate from the Webapp host's cookie/launch-link identity. */
export function createBrowserPlatformBridge(options: {
  bootstrap: BrowserBootstrap
  client?: PlatformClient
  openGateway?: (url: string) => Promise<JsonRpcGatewayClient>
  confirmRemote?: (host: string) => Promise<boolean>
}) {
  const client = options.client ?? createPlatformClient({ origin: PLATFORM_PRODUCTION_ORIGIN })

  // Only the native main process can persist an encrypted refresh token. A browser
  // tab keeps its credentials inside the same auth controller, never web storage.
  const auth = createPlatformAuth({
    client,
    now: Date.now,
    tokenStore: {
      load: async () => null,
      save: async () => 'session_only',
      clear: async () => undefined
    }
  })

  const initialized = auth.initialize()
  const deviceId = randomUuid()
  const origin = window.location.origin
  let disposed = false
  const ownerWindow = { isDestroyed: () => disposed }

  const bindings = createPlatformRuntimeBindingController({
    auth,
    origin: client.origin,
    deviceId: () => deviceId,
    confirmRemote: (_, host) => {
      if (options.confirmRemote) {
        return options.confirmRemote(host)
      }
      const prompt = platformBindingPrompt(getRuntimeI18nLocale(), host)

      return confirm({
        title: prompt.message,
        description: prompt.detail,
        cancelLabel: prompt.buttons[0],
        confirmLabel: prompt.buttons[1]
      })
    },
    async resolveConnection(connectionId, requestedProfile) {
      requireBrowserConnection(connectionId)
      const endpoint = new URL(origin)
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)

      if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) {
        throw new PlatformClientError('insecure_gateway')
      }

      const profile = requestedProfile.trim() || browserLaunchProfileOrDefault()

      return {
        fingerprint: JSON.stringify([origin, options.bootstrap.basePath, LOCAL_CONNECTION_ID, profile]),
        host: endpoint.host,
        remote: true,
        profile,
        // Foreground profile changes do not retarget background sessions. Each
        // binding retains its own profile, checked by the gateway ticket issuer.
        isCurrent: () => !disposed && window.location.origin === origin,
        async open() {
          const url = await ticketedWebsocketUrl(options.bootstrap, '/api/ws', profile)

          return (options.openGateway ?? openBrowserPlatformGateway)(url)
        }
      }
    }
  })

  let captchaIntent = 0

  async function captcha() {
    const intent = ++captchaIntent
    const generation = auth.generation()
    const capabilities = await auth.capabilities()

    if (disposed || generation !== auth.generation()) {
      throw new PlatformClientError('captcha_stale')
    }

    if (intent !== captchaIntent) {
      throw new PlatformClientError('captcha_superseded')
    }

    // The platform CAPTCHA page uses an isolated Electron preload. No browser
    // postMessage proof exchange is defined by that service contract yet.
    if (capabilities.captcha.provider !== 'disabled') {
      throw new PlatformClientError('captcha_browser_unavailable')
    }

    return {}
  }

  const platformAccount: PlatformAccountBridge = {
    status: async () => {
      await initialized

      return auth.snapshot()
    },
    capabilities: () => auth.capabilities(),
    retry: async () => {
      await initialized

      return auth.retry()
    },
    requestPhoneCode: async input => auth.requestPhoneCode({ phone: input.phone, captcha_proof: await captcha() }),
    verifyPhoneCode: async input => {
      await initialized

      return auth.verifyPhoneCode({ ...input, remember: false })
    },
    loginExisting: async input => {
      await initialized

      return auth.loginExisting({ ...input, remember: false, captcha_proof: await captcha() })
    },
    completeSecondFactor: input => auth.completeSecondFactor(input),
    updateProfile: input => auth.updateProfile(input),
    requestBindingCode: async input => auth.requestBindingCode({ ...input, captcha_proof: await captcha() }),
    submitStepUp: input => auth.submitStepUp(input),
    bindPhone: input => auth.bindPhone(input),
    logout: async expectedOwner => {
      await initialized
      const current = auth.snapshot()

      if (
        expectedOwner !== undefined &&
        (current.account?.id !== expectedOwner?.userId ||
          current.mode !== expectedOwner?.mode ||
          current.revision !== expectedOwner?.revision)
      ) {
        throw new PlatformClientError('platform_account_changed')
      }

      return auth.logout()
    },
    onChanged: listener => auth.subscribe(listener)
  }

  const platformModels: PlatformModelsBridge = {
    owner: async revision => bindings.owner(revision),
    list: () => bindings.list(),
    bind: input => bindings.bind(input, ownerWindow),
    clear: async input => bindings.clear(input, ownerWindow)
  }

  const platformBilling: PlatformBillingBridge = {
    scope: async input => auth.billingScope(input.expected_user_id),
    summary: async input => auth.walletSummary(input.expected_user_id),
    checkoutInfo: async input => auth.checkoutInfo(input.expected_user_id),
    quote: input => auth.quote(input, input.expected_user_id),
    createOrder: input => auth.createOrder(input, input.expected_user_id),
    getOrder: input => auth.getOrder(input.order_id, input.expected_user_id),
    listOrders: input => auth.listOrders(input, input.expected_user_id),
    cancelOrder: input => auth.cancelOrder(input.order_id, input.expected_user_id),
    listUsage: async input => auth.listUsage(input, input.expected_user_id),
    openCheckout: input =>
      openPlatformCheckout({
        auth,
        orderId: input.order_id,
        owner: input.expected_user_id,
        openBrowser: async url => {
          // Keeping the opener lets us detect popup blocking; remove it before
          // navigating to the validated payment URL.
          const popup = window.open('about:blank', '_blank')

          if (!popup) {
            throw new PlatformClientError('checkout_popup_blocked')
          }
          popup.opener = null
          popup.location.replace(url)
        }
      })
  }

  const platformDevices: PlatformDevicesBridge = {
    list: input => auth.listDevices(input),
    revoke: async input => {
      const result = await auth.revokeDevice(input.device_id, input)

      if (input.device_id.toLowerCase() === deviceId) {
        bindings.invalidateConnections()
      }

      return result
    }
  }

  return {
    bridge: { accountAdapter: 'platform' as const, platformAccount, platformModels, platformBilling, platformDevices },
    dispose() {
      disposed = true
      bindings.dispose()
    }
  }
}

/** Match the canonical gateway contract without leaking a ticket into the URL. */
export async function openBrowserPlatformGateway(wsUrl: string) {
  const rpc = new JsonRpcGatewayClient({
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    socketFactory: raw => {
      const url = new URL(raw)
      const ticket = url.searchParams.get('ticket')

      if (!ticket || !url.searchParams.has('native_dial')) {
        throw new Error('Gateway ticket required')
      }
      url.searchParams.delete('ticket')

      return new WebSocket(url.toString(), ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`])
    }
  })

  try {
    await rpc.connect(wsUrl)

    return rpc
  } catch (error) {
    rpc.close()
    throw error
  }
}
