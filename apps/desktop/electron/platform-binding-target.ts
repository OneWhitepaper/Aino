import { createHash } from 'node:crypto'

import { buildGatewayWsUrlWithTicket } from './connection-config'
import type { GatewayEndpoint } from './local-gateway'
import type { PlatformBindingTarget } from './platform-runtime-binding'
import { openPlatformGateway } from './platform-runtime-binding'

export interface ManagedGatewayDescriptor {
  baseUrl: string
  wsUrl: string
  mode: string
  authMode?: string
  remoteKind?: string
  remoteHost?: string
  remoteIdentity?: string
  sharedRemote?: boolean
  headers?: Record<string, string>
  token?: string | null
  gatewayEndpoint?: GatewayEndpoint
}

function bindingProfile(descriptor: ManagedGatewayDescriptor, profile: string): string {
  const shared =
    descriptor.gatewayEndpoint ||
    descriptor.sharedRemote ||
    (descriptor.mode !== 'local' && descriptor.remoteKind !== 'ssh')

  return shared ? profile || 'default' : 'default'
}

export async function resolvePlatformBindingTarget(input: {
  profile: string
  readConfiguration(): string
  readIdentity(baseUrl: string): string
  resolve(): Promise<ManagedGatewayDescriptor>
  mintTicket(baseUrl: string, headers: Record<string, string>): Promise<string>
  nativeDial?(profile: string): Promise<string>
}): Promise<PlatformBindingTarget> {
  const configuration = input.readConfiguration()
  const descriptor = await input.resolve()
  const identity = input.readIdentity(descriptor.baseUrl)

  if (input.readConfiguration() !== configuration) {
    throw new Error('binding_cancelled')
  }

  const endpoint = new URL(descriptor.wsUrl)
  const base = new URL(descriptor.baseUrl)
  const local = descriptor.mode === 'local'
  const tunnel = descriptor.remoteKind === 'ssh'
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)

  if (
    endpoint.username ||
    endpoint.password ||
    base.username ||
    base.password ||
    endpoint.host !== base.host ||
    endpoint.protocol !== (base.protocol === 'https:' ? 'wss:' : 'ws:') ||
    !['http:', 'https:'].includes(base.protocol) ||
    (local || tunnel ? !loopback : endpoint.protocol !== 'wss:')
  ) {
    throw new Error('insecure_gateway')
  }

  const headers = descriptor.headers ?? {}

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        configuration,
        identity,
        descriptor.baseUrl,
        descriptor.mode,
        descriptor.remoteKind,
        descriptor.remoteIdentity,
        descriptor.authMode,
        descriptor.token,
        headers
      ])
    )
    .digest('hex')

  return {
    fingerprint,
    host: tunnel ? descriptor.remoteHost || 'SSH' : base.host,
    remote: !local,
    profile: bindingProfile(descriptor, input.profile),
    isCurrent: () => input.readConfiguration() === configuration && input.readIdentity(descriptor.baseUrl) === identity,
    open: async () => {
      // Tickets on pooled descriptors may already have been consumed by the UI.
      const wsUrl = descriptor.gatewayEndpoint
        ? await input.nativeDial?.(input.profile)
        : descriptor.authMode === 'oauth'
          ? buildGatewayWsUrlWithTicket(descriptor.baseUrl, await input.mintTicket(descriptor.baseUrl, headers))
          : descriptor.wsUrl

      if (!wsUrl) {
        throw new Error('Native gateway ticket dial unavailable')
      }

      if (input.readConfiguration() !== configuration || input.readIdentity(descriptor.baseUrl) !== identity) {
        throw new Error('binding_cancelled')
      }

      return openPlatformGateway(wsUrl, headers)
    }
  }
}
