import type { SessionLiveInfo } from '@hermes/shared'
import type { MutableRefObject } from 'react'

import { codeModelCapabilityCopy } from '@/i18n/code-model-capability'
import { getRuntimeI18nLocale } from '@/i18n/runtime'
import { assertCodeModelCompatible, CodeModelCompatibilityError } from '@/lib/code-model-capability'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { notify } from '@/store/notifications'
import { verifiedPlatformModel } from '@/store/platform-model-capability'
import { platformModelCatalog } from '@/store/platform-models'
import { requestRoute } from '@/store/recovery-requests'
import { $sessions } from '@/store/session'
import { profileScopeForSessionOwner } from '@/store/session-request-router'
import { $sessionStates, knownOwnerForSession } from '@/store/session-states'

import type { SubmissionDestination } from './submission-destination'

export function notifyCodeModelRefusal(error: CodeModelCompatibilityError): void {
  const copy = codeModelCapabilityCopy(getRuntimeI18nLocale())
  notify({
    kind: 'warning',
    message: error.message,
    action: { label: copy.settings, onClick: () => requestRoute(error.settingsPath) }
  })
}

/** Stored Code chats keep their own model and owner even when another pane has focus.
 * New drafts are checked by desktopSessionCreateParams after resolving their Settings default. */
export async function preflightCodeSession({
  sessionId,
  storedSessionId,
  destination,
  isCurrent
}: {
  sessionId: string | null
  storedSessionId: string | null
  destination: SubmissionDestination
  isCurrent: () => boolean
}): Promise<void> {
  const target = storedSessionId || sessionId

  if (!target) {
    return
  }

  const readState = () => {
    const states = $sessionStates.get()
    const direct = sessionId ? states[sessionId] : undefined

    return direct && (!storedSessionId || !direct.storedSessionId || direct.storedSessionId === storedSessionId)
      ? direct
      : (states[target] ?? Object.values(states).find(state => state.storedSessionId === target))
  }

  const state = readState()
  const row = $sessions.get().find(candidate => candidate.id === target || candidate._lineage_root_id === target)

  if ((state?.executionMode ?? row?.execution_mode) !== 'code') {
    return
  }

  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const owner = JSON.stringify(knownOwnerForSession(target))
  const routeStamp = () => JSON.stringify([readState()?.provider, readState()?.model, readState()?.platformModel])
  const stamp = routeStamp()
  const ownerScope = profileScopeForSessionOwner(destination.owner)
  const capturedScope = platformDefaultScope(ownerScope)
  const scope = capturedScope.route

  const current = () =>
    isCurrent() &&
    account === catalog.account.get() &&
    owner === JSON.stringify(knownOwnerForSession(target)) &&
    stamp === routeStamp() &&
    ((typeof destination.owner === 'object' && destination.owner !== null) ||
      capturedScope.key === platformDefaultScope(ownerScope).key)

  // session.info reads the owner's existing route; it does not start a model turn.
  const info = await destination.requestGateway<SessionLiveInfo>('session.info', { session_id: target })

  if (!current()) {
    throw new CodeModelCompatibilityError('changed', scope)
  }

  const provider = state?.provider || info.provider || ''
  const model = state?.platformModel?.modelId || state?.model || info.model_id || info.model || ''
  await assertCodeModelCompatible({
    provider,
    model,
    scope,
    sessionInfo: info,
    platformModel: state?.platformModel
      ? verifiedPlatformModel(model, state.platformModel.ownerUserId, state.platformModel.platformOrigin)
      : null,
    isCurrent: current
  })
}

/** Pin only the foreground view; background queues remain on their captured destination. */
export function captureCodeSubmitView(
  foreground: boolean,
  selected: MutableRefObject<string | null>,
  readRoute: () => string
): () => boolean {
  const storedId = selected.current
  const route = readRoute()

  return () => !foreground || (selected.current === storedId && readRoute() === route)
}
