import { createPlatformDraft } from '@/api/platform-session-binding'
import { openSession, type OpenSessionNavigate } from '@/app/open-session'
import { desktopSessionCreateParams } from '@/app/session/hooks/use-session-actions/create-params'
import type { ReviewedHandoff } from '@/app/session/hooks/use-session-actions/handoff-contract'
import { handoffDraftText, recoverHandoffDraft } from '@/app/session/hooks/use-session-actions/handoff-draft'
import { upsertOptimisticSession } from '@/app/session/hooks/use-session-actions/utils'
import { handoffCopy } from '@/i18n/handoff'
import { getRuntimeI18nLocale } from '@/i18n/runtime'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { reloadPersistedDrafts, requestComposerDraftSync, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { rememberExecutionWorkspace } from '@/store/execution-mode'
import { retainGatewayForAgent } from '@/store/gateway'
import { modelPresetScope, setModelPreset } from '@/store/model-presets'
import { requestSessionResume, setSessionOwnerHint } from '@/store/session'
import { broadcastSessionsChanged } from '@/store/session-sync'
import type { SessionRuntimeInfo } from '@/types/hermes'

import { assertHandoffCurrent, type HandoffContext, readHandoffInfo, requestHandoffOwner } from './context'
import { flushHandoffDrafts, handoffDraftTarget } from './draft-target'

export type HandoffLink = NonNullable<SessionRuntimeInfo['linked_sessions']>[number]

export function reviewedHandoff(sourceId: string, summary: string, paths: string): ReviewedHandoff {
  const files = [
    ...new Set(
      paths
        .split('\n')
        .map(path => path.trim())
        .filter(Boolean)
    )
  ]

  if (
    !summary.trim() ||
    summary.length > 32000 ||
    summary.includes('\0') ||
    files.length > 32 ||
    files.some(path => path.length > 4096 || /[\0\r]/.test(path))
  ) {
    throw new Error(handoffCopy(getRuntimeI18nLocale()).invalid)
  }

  return { source_session_id: sourceId, summary: summary.trim(), files }
}

export async function createReviewedHandoff(
  context: HandoffContext,
  sourceMode: 'work' | 'code',
  handoff: ReviewedHandoff,
  requestId: string
) {
  assertHandoffCurrent(context, true)
  const mode = sourceMode === 'work' ? 'code' : 'work'

  const prepared = await desktopSessionCreateParams(
    context.cwd,
    context.owner,
    context.owner.profile,
    false,
    context.surface === 'tile' ? 'defaults' : true,
    {
      executionMode: mode,
      retainModelSelection: true,
      selection: context.selection,
      cwdExplicit: context.cwdExplicit,
      isCurrent: () => {
        assertHandoffCurrent(context, true)

        return true
      }
    }
  )

  assertHandoffCurrent(context, true)

  const release = await retainGatewayForAgent(context.owner.connectionId, context.owner.profile, {
    spawnPriority: 'foreground'
  })

  try {
    const params = { ...prepared.params, execution_mode: mode, handoff, request_id: requestId }

    const created = await createPlatformDraft(
      (method, payload) => requestHandoffOwner(context, method, payload, true),
      params,
      prepared.platformOwner,
      context.owner,
      prepared.platformAuthority
    )

    assertHandoffCurrent(context, true)
    const storedId = created.stored_session_id!
    setSessionOwnerHint(storedId, context.owner)
    upsertOptimisticSession(
      created,
      storedId,
      created.info?.title ?? null,
      null,
      context.sourceId,
      undefined,
      context.owner
    )
    recoverHandoffDraft(storedId, created)
    setModelPreset(
      context.selection.provider,
      context.selection.model,
      {
        effort: String(prepared.params.reasoning_effort ?? ''),
        fast: Boolean(prepared.params.fast),
        serviceTier: String(prepared.params.service_tier ?? '')
      },
      modelPresetScope(platformDefaultScope(context.owner).key, storedId)
    )
    broadcastSessionsChanged()

    return {
      session_id: storedId,
      title: created.info?.title ?? '',
      relation: 'child',
      execution_mode: mode
    } as HandoffLink
  } finally {
    release()
  }
}

export function openHandoffLink(context: HandoffContext, link: HandoffLink, navigate: OpenSessionNavigate): void {
  assertHandoffCurrent(context)
  const target = handoffDraftTarget(link.session_id, context.owner)
  rememberExecutionWorkspace()
  requestComposerDraftSync('flush')
  setSessionOwnerHint(target.storedId, context.owner)
  requestSessionResume(target.storedId, context.owner)
  openSession(target.storedId, navigate, 'main', { ownerRoute: context.owner, workspaceMode: 'sessions' })
}

export async function prepareHandoffReturn(context: HandoffContext, target: HandoffLink, handoff: ReviewedHandoff) {
  const info = await readHandoffInfo(context)

  const source = info.linked_sessions?.find(
    link => link.session_id === target.session_id && link.relation === 'source' && link.execution_mode === 'work'
  )

  if (!source) {
    throw new Error(handoffCopy(getRuntimeI18nLocale()).unproven)
  }

  const destination = handoffDraftTarget(target.session_id, context.owner)
  flushHandoffDrafts(destination.aliases)
  reloadPersistedDrafts()

  const hasDraft = destination.aliases.some(id => {
    const draft = takeSessionDraft(id)

    return draft.text || draft.attachments.length
  })

  if (hasDraft) {
    throw new Error(handoffCopy(getRuntimeI18nLocale()).draftExists)
  }

  assertHandoffCurrent(context)
  stashSessionDraft(destination.key, handoffDraftText(handoff), [])

  return source
}
