import { $notificationEpoch } from '@/store/notifications'
import { platformModelCatalog } from '@/store/platform-models'
import { $connection, getComposerSelectionGeneration } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { currentUserSessionOpen } from '@/store/session-open-intent'
import { isSessionOwnerRoute, requestForSessionProfile, type SessionOwnerRoute } from '@/store/session-request-router'
import { knownOwnerForSession } from '@/store/session-states'
import type { SessionRuntimeInfo } from '@/types/hermes'

import { type HandoffSource, handoffSourceChanged, type HandoffSurface, readHandoffSource } from './source'

export interface HandoffContext extends HandoffSource {
  storedId: string
  sourceId: string
  owner: SessionOwnerRoute
  notificationEpoch: number
  account: string
  selectionGeneration: number
  navigation: number
  connection: string
  surface: HandoffSurface
  focusedId: string | null
}

function accountIdentity(): string {
  const account = platformModelCatalog().account.get()

  return JSON.stringify([account?.mode, account?.account?.id, account?.revision])
}

export function captureHandoffContext(
  storedId: string,
  sourceId: string,
  surface: HandoffSurface = 'main'
): HandoffContext {
  const owner = knownOwnerForSession(storedId)

  if (!isSessionOwnerRoute(owner)) {
    return handoffSourceChanged()
  }

  return {
    storedId,
    sourceId,
    owner: { ...owner },
    notificationEpoch: $notificationEpoch.get(),
    account: accountIdentity(),
    selectionGeneration: getComposerSelectionGeneration(),
    navigation: currentUserSessionOpen(),
    connection: JSON.stringify($connection.get()),
    surface,
    focusedId: $focusedStoredSessionId.get(),
    ...readHandoffSource(storedId, sourceId, surface)
  }
}

export function assertHandoffCurrent(context: HandoffContext, checkModel = false): void {
  const currentOwner = knownOwnerForSession(context.storedId)
  const source = readHandoffSource(context.storedId, context.sourceId, context.surface)

  const sameOwner =
    isSessionOwnerRoute(currentOwner) &&
    currentOwner.connectionId === context.owner.connectionId &&
    currentOwner.profile === context.owner.profile &&
    currentOwner.targetProfile === context.owner.targetProfile

  const sameSelection =
    !checkModel ||
    ((context.surface === 'tile' || context.selectionGeneration === getComposerSelectionGeneration()) &&
      JSON.stringify(context.selection) === JSON.stringify(source.selection))

  if (
    !sameOwner ||
    !sameSelection ||
    context.notificationEpoch !== $notificationEpoch.get() ||
    context.account !== accountIdentity() ||
    context.navigation !== currentUserSessionOpen() ||
    context.connection !== JSON.stringify($connection.get()) ||
    context.focusedId !== $focusedStoredSessionId.get()
  ) {
    handoffSourceChanged()
  }
}

/** A fresh gesture may reselect the same chat; cached metadata never authorizes a new owner. */
export function recaptureHandoffContext(context: HandoffContext): HandoffContext {
  const current = captureHandoffContext(context.storedId, context.sourceId, context.surface)
  assertHandoffCurrent({ ...context, navigation: current.navigation, focusedId: current.focusedId })

  return current
}

export async function requestHandoffOwner<T>(
  context: HandoffContext,
  method: string,
  params: Record<string, unknown> = {},
  checkModel = false
): Promise<T> {
  assertHandoffCurrent(context, checkModel)
  const result = await requestForSessionProfile<T>(context.owner, handoffSourceChanged, method, params)
  assertHandoffCurrent(context, checkModel)

  return result
}

export function readHandoffInfo(context: HandoffContext): Promise<SessionRuntimeInfo> {
  return requestHandoffOwner(context, 'session.info', { session_id: context.sourceId })
}

/** Metadata may outlive a same-source refocus; it never authorizes an in-flight action. */
export async function readHandoffMetadata(context: HandoffContext) {
  const current = recaptureHandoffContext(context)

  const info = await requestForSessionProfile<SessionRuntimeInfo>(current.owner, handoffSourceChanged, 'session.info', {
    session_id: current.sourceId
  })

  return { info, context: recaptureHandoffContext(current) }
}
