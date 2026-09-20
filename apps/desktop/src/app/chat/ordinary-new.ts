import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationCapabilities } from '@hermes/shared/gateway-events'
import { atom } from 'nanostores'

import { requestGatewayForAgent } from '@/store/gateway'

/** Only a confirmed older/disabled service may fall back. Writes never do. */
export async function ordinaryNewKind(
  connectionId: string,
  request = requestGatewayForAgent
): Promise<'conversation' | 'legacy_session'> {
  let capabilities: ConversationCapabilities

  try {
    capabilities = await request<ConversationCapabilities>(connectionId, 'default', 'conversations.capabilities', {})
  } catch (error) {
    if (error instanceof JsonRpcGatewayError && error.code === -32601) {
      return 'legacy_session'
    }
    throw error
  }

  if (typeof capabilities.protocol_version !== 'number' || typeof capabilities.enabled !== 'boolean') {
    throw new Error('Invalid conversation capability response')
  }

  if (capabilities.protocol_version !== 1 || !capabilities.enabled) {
    return 'legacy_session'
  }

  return 'conversation'
}

/** Initial route discovery waits for existing last-session restoration. */
export const $ordinaryHomeReady = atom(false)
