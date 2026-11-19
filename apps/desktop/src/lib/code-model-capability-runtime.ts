import type { RuntimeDescribeResult } from '@hermes/shared'

import type { ProfileScope } from '@/api/client'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'

import { isMissingRpcMethod } from './gateway-rpc'
import { platformDefaultScope } from './platform-model-scope'

/** Read the existing canonical contract on the captured model owner, never the foreground socket. */
export async function readCodeModelRuntimeCapabilities(scope: ProfileScope, signal?: AbortSignal): Promise<string[]> {
  const { connectionId, profile } = platformDefaultScope(scope).route

  try {
    const description = connectionId
      ? await requestGatewayForAgent<RuntimeDescribeResult>(
          connectionId,
          profile,
          'runtime.describe',
          {},
          10_000,
          signal
        )
      : await requestGatewayForProfile<RuntimeDescribeResult>(profile, 'runtime.describe', {}, 10_000, signal)

    return Array.isArray(description?.capabilities)
      ? description.capabilities.filter((capability): capability is string => typeof capability === 'string')
      : []
  } catch (error) {
    if (isMissingRpcMethod(error)) {
      return []
    }

    throw error
  }
}
