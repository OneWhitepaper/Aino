import WebSocket from 'ws'

import { JsonRpcGatewayClient } from '../../shared/src/json-rpc-gateway'

const CANONICAL_GATEWAY_PROTOCOL = 'hermes-gateway-v1'

/** Auth headers are supplied only by the main-process connection resolver. */
export async function openPlatformGateway(wsUrl: string, headers: Record<string, string> = {}) {
  const rpc = new JsonRpcGatewayClient({
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    socketFactory: url => {
      const parsed = new URL(url)
      const native = parsed.searchParams.has('native_dial')
      const ticket = native ? parsed.searchParams.get('ticket') : null

      if (native && !ticket) {
        throw new Error('Native gateway requires a fresh private ticket')
      }

      if (ticket) {
        parsed.searchParams.delete('ticket')
      }

      return new WebSocket(
        parsed.toString(),
        native ? [CANONICAL_GATEWAY_PROTOCOL, `hermes-gateway-ticket.${ticket}`] : undefined,
        { headers }
      )
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
