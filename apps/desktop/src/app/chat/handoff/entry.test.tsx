import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { clearSessionDraft, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { requestGatewayForAgent } from '@/store/gateway'
import { $notificationEpoch } from '@/store/notifications'
import {
  $sessionResumeRequest,
  $sessions,
  setActiveSessionId,
  setConnection,
  setCurrentModelTransient,
  setCurrentProviderTransient,
  setSelectedStoredSessionId,
  setSessionOwnerHint,
  setSessions
} from '@/store/session'
import { noteUserSessionOpen } from '@/store/session-open-intent'
import { makeSessionInfo } from '@/test/session-info'

import { HandoffEntry } from './entry'

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForAgent: vi.fn(async () => () => undefined)
}))
vi.mock('@/app/session/hooks/use-session-actions/create-params', () => ({
  desktopSessionCreateParams: vi.fn(async () => ({
    params: { source: 'desktop', model: 'chosen', provider: 'custom:fixture', profile: 'default' },
    platformOwner: '',
    platformAuthority: null
  }))
}))

const owner = { connectionId: 'fixture', profile: 'default' }

const links = [
  { session_id: 'work-source', title: 'Design discussion', execution_mode: 'work', relation: 'source' },
  { session_id: 'code-child', title: 'Implementation', execution_mode: 'code', relation: 'child' }
]

let info: Record<string, unknown>
let supports: boolean
let create: (params: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  vi.clearAllMocks()
  setConnection({ mode: 'local', connectionId: 'fixture', profile: 'default' } as never)
  supports = true
  info = { execution_mode: 'work', linked_sessions: [] }
  create = async params => ({
    session_id: 'new-child',
    stored_session_id: 'new-child',
    message_count: 0,
    messages: [],
    info: { execution_mode: params.execution_mode, handoff: params.handoff, title: 'Backend-derived handoff title' }
  })
  setSessions([
    makeSessionInfo({ id: 'segment-source', profile: 'default', connection_id: 'fixture', execution_mode: 'work' })
  ])
  setSelectedStoredSessionId('segment-source')
  setActiveSessionId('logical-source')
  setSessionOwnerHint('segment-source', owner)
  setCurrentModelTransient('chosen')
  setCurrentProviderTransient('custom:fixture')
  $sessionResumeRequest.set(null)
  clearSessionDraft('new-child')
  clearSessionDraft('work-source')
  stashSessionDraft('segment-source', 'Keep my original draft', [])
  vi.mocked(requestGatewayForAgent).mockImplementation(async (_connection, _profile, method, params) => {
    if (method === 'runtime.describe') {
      return { capabilities: supports ? ['work-code-handoff-v1'] : [] } as never
    }

    if (method === 'session.info') {
      return info as never
    }

    if (method === 'session.create') {
      return (await create(params ?? {})) as never
    }

    throw new Error(`Unexpected RPC: ${method}`)
  })
})

afterEach(cleanup)

function mount() {
  return render(
    <MemoryRouter>
      <HandoffEntry runtimeSessionId="logical-source" storedSessionId="segment-source" />
    </MemoryRouter>
  )
}

async function review() {
  const trigger = await screen.findByRole('button', { name: 'Continue in Code' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  fireEvent.change(await screen.findByLabelText('Summary'), { target: { value: 'Reviewed implementation plan' } })
  fireEvent.change(screen.getByLabelText('Selected file paths'), { target: { value: 'src/app.ts\nsrc/style.css' } })
}

const creates = () => vi.mocked(requestGatewayForAgent).mock.calls.filter(call => call[2] === 'session.create')

it('cancels review without creating, sending or altering the source draft', async () => {
  mount()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(creates()).toHaveLength(0)
  expect(takeSessionDraft('segment-source').text).toBe('Keep my original draft')
  expect($sessionResumeRequest.get()).toBeNull()
})

it('can review again after the same session ID is explicitly reselected', async () => {
  mount()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  noteUserSessionOpen()
  await review()
  expect(screen.getByRole('dialog', { name: 'Review handoff' })).toBeTruthy()
  expect(creates()).toHaveLength(0)
})

it('opens a loaded source link after the same session is reselected', async () => {
  info = { execution_mode: 'code', linked_sessions: links }
  mount()
  const menu = await screen.findByRole('button', { name: 'Linked conversation' })
  noteUserSessionOpen()
  fireEvent.keyDown(menu, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /Design discussion/ }))
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: 'work-source', ownerRoute: owner })
})

it('creates once on repeated clicks, retains the canonical source ID and opens an unsent child draft', async () => {
  mount()
  await review()
  const button = screen.getByRole('button', { name: 'Create linked conversation' })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect($sessionResumeRequest.get()?.sessionId).toBe('new-child'))
  expect(creates()).toHaveLength(1)
  expect(creates()[0]?.slice(0, 2)).toEqual(['fixture', 'default'])
  expect(creates()[0]?.[3]).toMatchObject({
    model: 'chosen',
    execution_mode: 'code',
    handoff: {
      source_session_id: 'logical-source',
      summary: 'Reviewed implementation plan',
      files: ['src/app.ts', 'src/style.css']
    }
  })
  expect(creates()[0]?.[3]).not.toHaveProperty('title')
  expect($sessions.get().find(session => session.id === 'new-child')?.title).toBe('Backend-derived handoff title')
  expect(takeSessionDraft('new-child').text).toBe('Reviewed implementation plan\n\nsrc/app.ts\nsrc/style.css')
  expect(takeSessionDraft('segment-source').text).toBe('Keep my original draft')
  expect(vi.mocked(requestGatewayForAgent).mock.calls.some(call => call[2] === 'prompt.submit')).toBe(false)
})

it('reuses the same request key after a lost create acknowledgement', async () => {
  const success = create
  let first = true

  create = async params => {
    if (first) {
      first = false
      throw new Error('Lost acknowledgement')
    }

    return success(params)
  }

  mount()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await screen.findByText('Lost acknowledgement')
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await waitFor(() => expect(creates()).toHaveLength(2))
  expect(creates()[0]?.[3]?.request_id).toBeTruthy()
  expect(creates()[1]?.[3]?.request_id).toBe(creates()[0]?.[3]?.request_id)
})

it('rejects an older gateway before any create', async () => {
  supports = false
  mount()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await screen.findByText(/This gateway does not support Work\/Code handoffs/)
  expect(creates()).toHaveLength(0)
})

it('uses a new request identity when the reviewed payload changes after a failed attempt', async () => {
  create = async () => {
    throw new Error('Lost acknowledgement')
  }

  mount()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await screen.findByText('Lost acknowledgement')
  fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'A different reviewed plan' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await waitFor(() => expect(creates()).toHaveLength(2))
  expect(creates()[1]?.[3]?.request_id).not.toBe(creates()[0]?.[3]?.request_id)
})

it('refuses model drift after review instead of silently choosing another model', async () => {
  mount()
  await review()
  setCurrentModelTransient('different-model')
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await screen.findByText(/The conversation, owner or model changed/)
  expect(creates()).toHaveLength(0)
})

it('does not publish a child or draft if the account changes while create is pending', async () => {
  let finish!: (value: unknown) => void
  create = params =>
    new Promise(resolve => {
      finish = () =>
        resolve({
          session_id: 'new-child',
          stored_session_id: 'new-child',
          message_count: 0,
          messages: [],
          info: { execution_mode: 'code', handoff: params.handoff }
        })
    })
  mount()
  await review()
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await waitFor(() => expect(creates()).toHaveLength(1))
  await act(async () => {
    $notificationEpoch.set($notificationEpoch.get() + 1)
    finish({})
  })
  expect(takeSessionDraft('new-child').text).toBe('')
  expect($sessionResumeRequest.get()).toBeNull()
})

it.each(links)('opens the explicit $relation link on the captured owner', async link => {
  info = { execution_mode: 'code', linked_sessions: links }
  mount()
  fireEvent.keyDown(await screen.findByRole('button', { name: 'Linked conversation' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(link.title) }))
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: link.session_id, ownerRoute: owner })
  expect(creates()).toHaveLength(0)
})

it('requires review to return a result and preserves an existing Work draft', async () => {
  info = { execution_mode: 'code', linked_sessions: links }
  stashSessionDraft('work-source', 'Do not replace this', [])
  mount()
  fireEvent.keyDown(await screen.findByRole('button', { name: 'Linked conversation' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Return result to Work' }))
  fireEvent.change(await screen.findByLabelText('Summary'), { target: { value: 'Reviewed result' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add reviewed result to Work draft' }))
  await screen.findByText(/Work already has an unsent draft/)
  expect(takeSessionDraft('work-source').text).toBe('Do not replace this')
  expect($sessionResumeRequest.get()).toBeNull()
  expect(creates()).toHaveLength(0)
})

it('refuses a stale source-owner link even when the new owner uses the same session IDs', async () => {
  info = { execution_mode: 'code', linked_sessions: links }
  mount()
  const menu = await screen.findByRole('button', { name: 'Linked conversation' })
  setConnection({ mode: 'local', connectionId: 'other-owner', profile: 'default' } as never)
  fireEvent.keyDown(menu, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /Design discussion/ }))
  expect($sessionResumeRequest.get()).toBeNull()
})

it('prepares a reviewed return draft without creating or submitting a turn', async () => {
  info = { execution_mode: 'code', linked_sessions: links }
  mount()
  fireEvent.keyDown(await screen.findByRole('button', { name: 'Linked conversation' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Return result to Work' }))
  expect(takeSessionDraft('work-source').text).toBe('')
  fireEvent.change(await screen.findByLabelText('Summary'), { target: { value: 'Verified implementation result' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add reviewed result to Work draft' }))
  await waitFor(() => expect($sessionResumeRequest.get()?.sessionId).toBe('work-source'))
  expect(takeSessionDraft('work-source').text).toBe('Verified implementation result')
  expect(creates()).toHaveLength(0)
  expect(vi.mocked(requestGatewayForAgent).mock.calls.some(call => call[2] === 'prompt.submit')).toBe(false)
})

it('refuses a changed source owner before create while preserving the reviewed input', async () => {
  mount()
  await review()
  setConnection({ mode: 'local', connectionId: 'other-owner', profile: 'default' } as never)
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await screen.findByText(/The conversation, owner or model changed/)
  expect(creates()).toHaveLength(0)
  expect((screen.getByLabelText('Summary') as HTMLTextAreaElement).value).toBe('Reviewed implementation plan')
})
