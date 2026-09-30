import { randomUUID } from 'node:crypto'

import { JsonRpcGatewayClient } from '../../shared/src/json-rpc-gateway'
import type { BindPlatformModelInput, BindPlatformModelResult, PlatformModel } from '../shared/platform-contract'

import type { PlatformAuth } from './platform-auth'
import { PlatformClientError } from './platform-client'

export interface PlatformBindingTarget {
  fingerprint: string
  host: string
  remote: boolean
  profile: string
  isCurrent(): boolean
  open(): Promise<JsonRpcGatewayClient>
}
export interface PlatformBindingWindow {
  isDestroyed(): boolean
}
export interface PlatformRuntimeBindingController {
  owner(expectedAccountRevision: number): { platform_origin: string; user_id: string }
  bind(
    input: BindPlatformModelInput & { session_ticket: string },
    window: PlatformBindingWindow
  ): Promise<BindPlatformModelResult>
  clear(input: { connection_id: string; profile: string; session_id: string }, window: PlatformBindingWindow): void
  list(): Promise<PlatformModel[]>
  releaseWindow(window: PlatformBindingWindow): void
  invalidateConnections(): void
  dispose(): void
}
interface Binding {
  target: PlatformBindingTarget
  rpc: JsonRpcGatewayClient
  grant: string
  revision: number
  session: string
  expiry?: ReturnType<typeof setTimeout>
  renewal?: ReturnType<typeof setTimeout>
}
interface Slot {
  intent: number
  active?: Binding
  pending?: Binding
}

export function createPlatformRuntimeBindingController(options: {
  auth: PlatformAuth
  origin: string
  deviceId(): string
  resolveConnection(connectionId: string, profile: string): Promise<PlatformBindingTarget>
  confirmRemote(window: PlatformBindingWindow, host: string): Promise<boolean>
}): PlatformRuntimeBindingController {
  const { auth } = options
  const windows = new Map<PlatformBindingWindow, Map<string, Slot>>()
  let generation = auth.generation()
  let disposed = false

  function close(binding?: Binding) {
    if (!binding) {
      return
    }

    clearTimeout(binding.expiry)
    clearTimeout(binding.renewal)
    // Socket ownership on the gateway clears both pending claims and active
    // bindings even if the network cannot deliver a final clear RPC.
    binding.rpc.close()
  }

  function reset(slot: Slot) {
    slot.intent++
    close(slot.pending)

    if (slot.active !== slot.pending) {
      close(slot.active)
    }

    slot.active = slot.pending = undefined
  }

  function scope(input: { connection_id: string; profile: string; session_id: string }) {
    return JSON.stringify([input.connection_id, input.profile, input.session_id])
  }

  function resetAll() {
    for (const slots of windows.values()) {
      for (const slot of slots.values()) {
        reset(slot)
      }
    }

    windows.clear()
  }

  function armLease(binding: Binding, expiresAt: string, expired: () => void, renew: () => Promise<void>) {
    clearTimeout(binding.expiry)
    clearTimeout(binding.renewal)
    const ttl = Math.max(0, Date.parse(expiresAt) - Date.now())
    binding.expiry = setTimeout(expired, ttl)
    binding.expiry.unref?.()
    binding.renewal = setTimeout(() => void renew(), Math.min(20 * 60_000, Math.max(5_000, ttl / 3)))
    binding.renewal.unref?.()
  }

  const unsubscribe = auth.subscribe(snapshot => {
    if (generation !== auth.generation() || snapshot.phase === 'signed_out' || snapshot.phase === 'reauth_required') {
      generation = auth.generation()
      resetAll()
    }
  })

  return {
    owner(expectedAccountRevision) {
      const snapshot = auth.snapshot()

      if (snapshot.phase !== 'signed_in' || !snapshot.account || snapshot.revision !== expectedAccountRevision) {
        throw new Error('invalid_platform_input')
      }

      return { platform_origin: options.origin, user_id: snapshot.account.id }
    },
    async bind(input, window) {
      const failure = (code: string): BindPlatformModelResult => ({ ok: false, error: { code } })
      const snapshot = auth.snapshot()

      if (!snapshot.account || snapshot.phase !== 'signed_in') {
        return failure('not_authenticated')
      }

      if (snapshot.revision !== input.expected_account_revision) {
        return failure('stale_account_revision')
      }

      if (
        ![input.session_id, input.model_id, input.session_ticket].every(
          s => typeof s === 'string' && s.length > 0 && s.length <= 256
        )
      ) {
        return failure('invalid_platform_input')
      }

      if (disposed || window.isDestroyed()) {
        return failure('binding_cancelled')
      }

      const expected = auth.generation()
      const account = snapshot.account.id
      const slots = windows.get(window) ?? new Map<string, Slot>()
      windows.set(window, slots)
      const key = scope(input)
      const slot = slots.get(key) ?? { intent: 0 }
      slots.set(key, slot)
      const intent = ++slot.intent
      let binding: Binding | undefined
      let claimedRevision = 0

      const current = () =>
        !disposed &&
        !window.isDestroyed() &&
        slot.intent === intent &&
        auth.generation() === expected &&
        auth.snapshot().account?.id === account &&
        auth.snapshot().phase !== 'reauth_required' &&
        (!binding || binding.target.isCurrent())

      const check = () => {
        if (!current()) {
          throw new Error('binding_cancelled')
        }
      }

      try {
        const target = await options.resolveConnection(input.connection_id, input.profile)
        check()

        if (!target.isCurrent()) {
          throw new Error('binding_cancelled')
        }

        if (slot.active?.target.fingerprint === target.fingerprint && slot.active.rpc.connectionState === 'open') {
          binding = slot.active
        } else {
          if (target.remote && !(await options.confirmRemote(window, target.host))) {
            return failure('remote_not_authorized')
          }

          check()

          if (!target.isCurrent()) {
            throw new Error('binding_cancelled')
          }

          const rpc = await target.open()
          binding = { target, rpc, grant: randomUUID(), revision: 0, session: input.session_id }

          if (!current()) {
            close(binding)
            throw new Error('binding_cancelled')
          }
        }

        slot.pending = binding
        const owner = { platform_origin: options.origin, user_id: account }
        const params = { session_id: input.session_id, profile: target.profile, owner, model_id: input.model_id }

        // Capability and live session authorization are proven BEFORE obtaining
        // the inference secret. Older gateways fail here without receiving a Key.
        const claim = await binding.rpc.request<{ managed_model_binding?: number; binding_revision?: number }>(
          'session.claim_managed_model',
          { ...params, session_ticket: input.session_ticket }
        )

        check()

        if (
          claim.managed_model_binding !== 1 ||
          !Number.isSafeInteger(claim.binding_revision) ||
          claim.binding_revision! <= 0
        ) {
          throw new Error('unsupported_gateway')
        }

        claimedRevision = claim.binding_revision!

        const lease = await auth.modelLease({
          model_id: input.model_id,
          device_id: options.deviceId(),
          connection_grant_id: binding.grant
        })

        check()

        const result = await binding.rpc.request<{ bound?: boolean; model_id?: string; binding_revision?: number }>(
          'session.bind_managed_model',
          {
            ...params,
            binding_revision: claimedRevision,
            model: lease.model.model,
            api_mode: lease.model.api_mode,
            capabilities: lease.model.capabilities,
            credential_id: lease.credential_id,
            api_key: lease.api_key,
            base_url: lease.base_url,
            expires_at: lease.expires_at
          }
        )

        check()

        if (!result.bound || result.model_id !== input.model_id || result.binding_revision !== claimedRevision) {
          throw new Error('invalid_binding_response')
        }

        if (slot.active !== binding) {
          close(slot.active)
        }

        binding.revision = claimedRevision
        const retained = binding
        const revision = claimedRevision
        const stillOwned = () => current() && slot.active === retained && retained.revision === revision

        const expire = () => {
          if (slot.active === retained && retained.revision === revision) {
            reset(slot)
            slots.delete(key)
          }
        }

        const renew = async () => {
          if (!stillOwned()) {
            return
          }

          try {
            const next = await auth.modelLease({
              model_id: input.model_id,
              device_id: options.deviceId(),
              connection_grant_id: retained.grant
            })

            if (!stillOwned()) {
              return
            }

            const renewed = await retained.rpc.request<{
              bound?: boolean
              model_id?: string
              binding_revision?: number
            }>('session.renew_managed_model', {
              ...params,
              binding_revision: revision,
              model: next.model.model,
              api_mode: next.model.api_mode,
              capabilities: next.model.capabilities,
              credential_id: next.credential_id,
              api_key: next.api_key,
              base_url: next.base_url,
              expires_at: next.expires_at
            })

            if (!stillOwned()) {
              return
            }

            if (!renewed.bound || renewed.model_id !== input.model_id || renewed.binding_revision !== revision) {
              expire()

              return
            }

            armLease(retained, next.expires_at, expire, renew)
          } catch (error) {
            // No retry loop: a network failure retains the current lease only
            // until its original deadline. Confirmed auth loss revokes now.
            if (error instanceof PlatformClientError && error.authentication) {
              expire()
            }
          }
        }

        slot.active = binding
        slot.pending = undefined
        armLease(retained, lease.expires_at, expire, renew)

        return { ok: true, ready: true, model_id: input.model_id, billing_source: 'aino', expires_at: lease.expires_at }
      } catch (error) {
        if (binding && claimedRevision) {
          // A late response must only clear its own revision, never a newer bind.
          await binding.rpc
            .request(
              'session.clear_managed_model',
              {
                session_id: input.session_id,
                profile: binding.target.profile,
                binding_revision: claimedRevision
              },
              2000
            )
            .catch(() => undefined)
        }

        if (binding && slot.active !== binding && slot.pending !== binding) {
          close(binding)
        }

        if (slot.intent === intent) {
          if (binding !== slot.active) {
            close(binding)
          }

          slot.pending = undefined
        }

        const codes = new Set(['binding_cancelled', 'unsupported_gateway', 'invalid_binding_response'])

        const code =
          error instanceof PlatformClientError
            ? error.code
            : error instanceof Error && codes.has(error.message)
              ? error.message
              : 'gateway_binding_failed'

        return failure(code)
      }
    },
    list: () => auth.models(),
    clear(input, window) {
      const slots = windows.get(window)
      const key = scope(input)
      const slot = slots?.get(key)

      if (slot) {
        reset(slot)
        slots?.delete(key)
      }
    },
    releaseWindow(window) {
      for (const slot of windows.get(window)?.values() ?? []) {
        reset(slot)
      }

      windows.delete(window)
    },
    invalidateConnections: resetAll,
    dispose() {
      disposed = true
      unsubscribe()
      resetAll()
    }
  }
}

/** Auth headers are supplied only by the main-process connection resolver. */
export async function openPlatformGateway(wsUrl: string, headers: Record<string, string> = {}) {
  const rpc = new JsonRpcGatewayClient({
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    socketFactory: url =>
      new (
        WebSocket as unknown as {
          new (url: string, options: { headers: Record<string, string> }): WebSocket
        }
      )(url, { headers })
  })

  try {
    await rpc.connect(wsUrl)

    return rpc
  } catch (error) {
    rpc.close()
    throw error
  }
}
