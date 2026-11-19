import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import { clearSessionDraft, onComposerDraftSyncRequest, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { requestGatewayForAgent } from '@/store/gateway'
import {
  $sessionResumeRequest,
  setActiveSessionId,
  setConnection,
  setSelectedStoredSessionId,
  setSessionOwnerHint,
  setSessions
} from '@/store/session'
import { dropSessionState, publishSessionState } from '@/store/session-states'
import { makeSessionInfo } from '@/test/session-info'

import { openHandoffLink, prepareHandoffReturn } from './actions'
import { captureHandoffContext } from './context'

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn()
}))

const owner = { connectionId: 'fixture', profile: 'default' }
const target = { session_id: 'work-logical', title: 'Work', execution_mode: 'work', relation: 'source' } as const
const reviewed = { source_session_id: 'code-child', summary: 'Reviewed result', files: ['src/app.ts'] }

beforeEach(() => {
  vi.clearAllMocks()
  setConnection({ mode: 'local', ...owner } as never)
  setSessions([makeSessionInfo({ id: 'code-child', connection_id: owner.connectionId, profile: owner.profile })])
  setSelectedStoredSessionId('code-child')
  setActiveSessionId('code-child')
  setSessionOwnerHint('code-child', owner)
  setSessionOwnerHint('work-physical', owner)
  $sessionResumeRequest.set(null)

  for (const id of ['work-logical', 'work-physical', 'work-root', 'work-middle']) {
    clearSessionDraft(id)
  }

  vi.mocked(requestGatewayForAgent).mockResolvedValue({ execution_mode: 'code', linked_sessions: [target] } as never)
})

afterEach(() => {
  dropSessionState('work-logical')
})

it('refuses a return when the canonical runtime is bound to an existing physical-keyed Work draft', async () => {
  publishSessionState('work-logical', createClientSessionState('work-physical'))
  stashSessionDraft('work-physical', 'Keep the original Work draft', [])

  await expect(
    prepareHandoffReturn(captureHandoffContext('code-child', 'code-child'), target, reviewed)
  ).rejects.toThrow(/Work already has an unsent draft/)

  expect(takeSessionDraft('work-physical').text).toBe('Keep the original Work draft')
  expect(takeSessionDraft('work-logical').text).toBe('')
  expect($sessionResumeRequest.get()).toBeNull()
})

it.each(['work-root', 'work-middle'])('preserves a %s draft across compression and adoption', async draftId => {
  setSessions([
    makeSessionInfo({
      id: 'work-logical',
      _lineage_root_id: 'work-root',
      _lineage_ids: ['work-root', 'work-middle', 'work-logical'],
      connection_id: owner.connectionId,
      profile: owner.profile
    })
  ])
  stashSessionDraft(draftId, 'Unsent before compression', [])

  await expect(
    prepareHandoffReturn(captureHandoffContext('code-child', 'code-child'), target, reviewed)
  ).rejects.toThrow(/Work already has an unsent draft/)
  expect(takeSessionDraft(draftId).text).toBe('Unsent before compression')
  expect(takeSessionDraft('work-logical').text).toBe('')
})

it('flushes the aliased Work tile before deciding its draft is empty', async () => {
  publishSessionState('work-logical', createClientSessionState('work-physical'))

  const stop = onComposerDraftSyncRequest(({ mode, target: surface }) => {
    if (mode === 'flush' && surface === 'tile:work-physical') {
      stashSessionDraft('work-physical', 'Just typed in the Work tile', [])
    }
  })

  try {
    await expect(
      prepareHandoffReturn(captureHandoffContext('code-child', 'code-child'), target, reviewed)
    ).rejects.toThrow(/Work already has an unsent draft/)
    expect(takeSessionDraft('work-physical').text).toBe('Just typed in the Work tile')
    expect(takeSessionDraft('work-logical').text).toBe('')
  } finally {
    stop()
  }
})

it('writes and opens the existing physical binding when Work has no draft', async () => {
  publishSessionState('work-logical', createClientSessionState('work-physical'))
  const context = captureHandoffContext('code-child', 'code-child')
  const link = await prepareHandoffReturn(context, target, reviewed)
  openHandoffLink(context, link, vi.fn())
  expect(takeSessionDraft('work-physical').text).toBe('Reviewed result\n\nsrc/app.ts')
  expect(takeSessionDraft('work-logical').text).toBe('')
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: 'work-physical', ownerRoute: owner })
})
