import { translateNow } from '@/i18n'
import { requestGatewayForAgent, retainGatewayForAgent } from '@/store/gateway'
import type { AgentProfileRoute } from '@/store/profile'
import type { SessionCreateResponse } from '@/types/hermes'

import { confirmHandoffProvenance, requireHandoffCapability } from './handoff-contract'

type RequestGateway = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export async function retainSessionCreateOwner(
  route: AgentProfileRoute | null,
  managedProfileOnly: boolean,
  profile: string
) {
  return route || managedProfileOnly
    ? await retainGatewayForAgent(route?.connectionId ?? null, profile, { spawnPriority: 'foreground' })
    : () => undefined
}

export function sessionCreateOwnerRequest(
  route: AgentProfileRoute | null,
  managedProfileOnly: boolean,
  profile: string,
  requestGateway: RequestGateway
): RequestGateway {
  return route || managedProfileOnly
    ? (method, payload) =>
        requestGatewayForAgent(route?.connectionId ?? null, profile, method, payload, undefined, undefined, {
          spawnPriority: 'foreground'
        })
    : requestGateway
}

/** A backend predating a `session.create` field rejects the whole create at
 *  admission (`tui_gateway/contracts/registry.py::validate_params`, code 4000,
 *  handler never runs) — e.g. a Hermes Cloud backend behind a Desktop that
 *  updates from main (#128971). Each field below is safe to drop for them:
 *  - `cwd_explicit` (#122899): those backends always honoured the client `cwd`.
 *  - `service_tier` (Ultrafast): `fast` still rides, so they get Priority.
 *  Matched on the stable prefix, not `isOutOfSyncRpcParams`: v0.21.3 already
 *  rejects but predates the "out of sync" suffix.
 *  Delete a field once no supported backend predates it. */
const DROPPABLE_CREATE_FIELDS = ['cwd_explicit', 'service_tier'] as const

function rejectedField(params: Record<string, unknown>, error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)

  return DROPPABLE_CREATE_FIELDS.find(
    field => field in params && message.includes(`invalid params for session.create: ${field}:`)
  )
}

function rejectsCodeContract(params: Record<string, unknown>, error: unknown): boolean {
  return (
    params.execution_mode === 'code' &&
    ['execution_mode', 'cwd_explicit'].some(field =>
      String(error).includes(`invalid params for session.create: ${field}:`)
    )
  )
}

async function confirmCreatedExecutionMode(
  created: SessionCreateResponse,
  params: Record<string, unknown>,
  request: RequestGateway
): Promise<SessionCreateResponse> {
  if (params.execution_mode !== 'code' || created.info?.execution_mode === 'code') {
    return created
  }

  const error = new Error(translateNow('executionMode.unsupportedGateway'))

  // An older service may silently ignore the new field. Close only this fresh,
  // unsubmitted runtime on its captured owner; never send the Code prompt to it.
  try {
    await request('session.close', { session_id: created.session_id })
  } catch (cause) {
    error.cause = cause
  }

  throw error
}

/** `session.create` on the captured owner route (or the window's gateway). */
export async function createGatewaySession(
  route: AgentProfileRoute | null,
  params: Record<string, unknown>,
  requestGateway: RequestGateway
): Promise<SessionCreateResponse> {
  const request = sessionCreateOwnerRequest(route, false, route?.profile ?? '', requestGateway)

  if (params.handoff) {
    await requireHandoffCapability(request)
    const created = await request<SessionCreateResponse>('session.create', params)
    confirmHandoffProvenance(created, params)

    return created
  }

  // One resend per dropped field: a backend predating both rejects them one at a time.
  const create = async (requestParams: Record<string, unknown>): Promise<SessionCreateResponse> => {
    try {
      return await request<SessionCreateResponse>('session.create', requestParams)
    } catch (error) {
      if (rejectsCodeContract(requestParams, error)) {
        throw new Error(translateNow('executionMode.unsupportedGateway'))
      }

      const field = rejectedField(requestParams, error)

      if (!field) {
        throw error
      }

      const { [field]: _dropped, ...compatible } = requestParams

      return create(compatible)
    }
  }

  return confirmCreatedExecutionMode(await create(params), params, request)
}
