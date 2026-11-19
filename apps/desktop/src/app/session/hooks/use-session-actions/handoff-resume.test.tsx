import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getGlobalModelInfo, getLatestSessionMessages, listSidebarSessions } from '@/hermes'
import { clearSessionDraft, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { requestGatewayForAgent } from '@/store/gateway'
import {
  $sessions,
  setActiveSessionId,
  setSelectedStoredSessionId,
  setSessionOwnerHint,
  setSessions
} from '@/store/session'
import { makeSessionInfo } from '@/test/session-info'

import { clientState, ResumeHarness } from '../use-session-actions-resume-harness'
import { useSessionListActions } from '../use-session-list-actions'

vi.mock('@/hermes', async original => ({
  ...(await original<Record<string, unknown>>()),
  getGlobalModelInfo: vi.fn(),
  getLatestSessionMessages: vi.fn(),
  listSidebarSessions: vi.fn()
}))
vi.mock('@/store/profile', async original => ({
  ...(await original<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn(),
  ensureGatewayProfile: vi.fn()
}))
vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForAgent: vi.fn(async () => () => undefined)
}))

const owner = { connectionId: 'fixture', profile: 'default' }
const handoff = { source_session_id: 'source-work', summary: 'Reviewed on Work', files: ['src/app.ts'] }
let nextId = 0

beforeEach(() => {
  vi.clearAllMocks()
  setActiveSessionId(null)
  setSelectedStoredSessionId(null)
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: 'chosen', provider: 'custom:fixture' })
  vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], has_more: false } as never)
})
afterEach(cleanup)

it.each(['cold', 'warm'])(
  'reloads a titled empty child from the sidebar and restores its draft through %s resume',
  async kind => {
    const storedId = `handoff-resume-${nextId++}`
    const runtimeId = `logical-${storedId}`

    const child = makeSessionInfo({
      id: storedId,
      profile: owner.profile,
      connection_id: owner.connectionId,
      title: 'Durable reviewed title',
      message_count: 0,
      _branched_from: handoff.source_session_id,
      execution_mode: 'code'
    })

    // No optimistic row survives reload: only the owner's list can make this empty child discoverable.
    setSessions([])
    vi.mocked(listSidebarSessions).mockResolvedValue({
      recents: { sessions: [child] },
      cron: { sessions: [] },
      messaging: { sessions: [] }
    })
    const listing = renderHook(() => useSessionListActions({ profileScope: owner.profile }))
    await act(async () => {
      await listing.result.current.refreshSessions()
    })
    expect($sessions.get()).toEqual([child])
    setSessionOwnerHint(storedId, owner)
    vi.mocked(requestGatewayForAgent).mockImplementation(async (_connection, _profile, method) => {
      if (method === 'session.resume' || method === 'session.activate') {
        return {
          session_id: runtimeId,
          stored_session_id: storedId,
          message_count: 0,
          messages: [],
          info: { execution_mode: 'code', handoff },
          running: false
        } as never
      }

      throw new Error(`Unexpected RPC ${method}`)
    })

    const maps = {
      runtimeIdByStoredSessionIdRef: { current: new Map(kind === 'warm' ? [[storedId, runtimeId]] : []) },
      sessionStateByRuntimeIdRef: { current: new Map(kind === 'warm' ? [[runtimeId, clientState(storedId)]] : []) }
    }

    let resume: Parameters<typeof ResumeHarness>[0]['onReady'] extends (resume: infer R) => void ? R : never
    render(
      <ResumeHarness
        onReady={action => {
          resume = action
        }}
        requestGateway={vi.fn()}
        {...maps}
      />
    )
    await waitFor(() => expect(resume).toBeTypeOf('function'))
    await act(async () => {
      await resume(storedId, true, owner)
    })
    expect(takeSessionDraft(storedId).text).toBe('Reviewed on Work\n\nsrc/app.ts')
    expect($sessions.get().find(session => session.id === storedId)?.title).toBe('Durable reviewed title')
    expect(vi.mocked(requestGatewayForAgent).mock.calls.map(call => call[2])).toContain(
      kind === 'warm' ? 'session.activate' : 'session.resume'
    )

    stashSessionDraft(storedId, 'My edited draft', [])
    await act(async () => {
      await resume(storedId, true, owner)
    })
    expect(takeSessionDraft(storedId).text).toBe('My edited draft')
    clearSessionDraft(storedId)
    await act(async () => {
      await resume(storedId, true, owner)
    })
    expect(takeSessionDraft(storedId).text).toBe('')
  }
)
