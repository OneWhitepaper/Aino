import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { getCustomEndpoints } from '@/api/config'
import { watchSessionTiles } from '@/app/chat/session-tile'
import { group, split } from '@/components/pane-shell/tree/model'
import { TreeGroup } from '@/components/pane-shell/tree/renderer/tree-group'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import { createClientSessionState } from '@/lib/chat-runtime'
import { stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { requestGatewayForAgent } from '@/store/gateway'
import {
  $currentModel,
  $sessionResumeRequest,
  setActiveSessionId,
  setCurrentCwdExplicit,
  setCurrentModelTransient,
  setCurrentProviderTransient,
  setSelectedStoredSessionId,
  setSessions
} from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { makeSessionInfo } from '@/test/session-info'

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForAgent: vi.fn(async () => () => undefined)
}))
vi.mock('@/store/profile', async original => ({
  ...(await original<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn(),
  ensureGatewayProfile: vi.fn()
}))
vi.mock('@/api/config', async original => ({
  ...(await original<Record<string, unknown>>()),
  getCustomEndpoints: vi.fn(async () => ({ endpoints: [] }))
}))
vi.mock('@/api/models', async original => ({
  ...(await original<Record<string, unknown>>()),
  getGlobalModelOptions: vi.fn(async () => ({ providers: [] }))
}))

const owner = { connectionId: 'tile-connection', profile: 'builder', targetProfile: 'remote-builder' }
const tileId = 'tile-physical'
const runtimeId = 'tile-logical'
const paneId = `session-tile:${tileId}`
const node = group([paneId], { id: 'tile-zone', active: paneId })
let mode: 'work' | 'code'
let childId: string
let sequence = 0
let disposePrimary: (() => void) | undefined

beforeAll(() => {
  watchSessionTiles()
})
beforeEach(() => {
  vi.clearAllMocks()
  stubResizeObserver()
  stubMenuDomApis()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  mode = 'work'
  childId = `tile-child-${++sequence}`
  setSelectedStoredSessionId('primary-physical')
  setActiveSessionId('primary-logical')
  setCurrentModelTransient('primary-model')
  setCurrentProviderTransient('custom:primary')
  setCurrentCwdExplicit(true)
  setSessions([
    makeSessionInfo({ id: tileId, title: 'Tile task', connection_id: owner.connectionId, profile: owner.profile })
  ])
  $sessionTiles.set([{ storedSessionId: tileId, runtimeId, ownerRoute: owner }])
  // Keep the mirror's real header/actions; the transcript body is not part of this header interaction.
  const tilePane = registry.getArea('panes').find(pane => pane.id === paneId)!
  registry.register({ ...tilePane, render: () => null })
  $sessionStates.set({
    [runtimeId]: {
      ...createClientSessionState(tileId),
      model: 'tile-model',
      provider: 'custom:tile',
      cwd: '/tile-project',
      reasoningEffort: 'high',
      fast: true,
      messages: [{ id: 'tile-user', role: 'user', parts: [{ type: 'text', text: 'Tile goal' }], timestamp: 1 }]
    }
  })
  $layoutTree.set(node)
  $activeTreeGroup.set(node.id)
  $sessionResumeRequest.set(null)
  stashSessionDraft(tileId, 'Unsent tile text', [])
  vi.mocked(requestGatewayForAgent).mockImplementation(async (_connection, _profile, method, params) => {
    if (method === 'session.info') {
      return { execution_mode: mode, linked_sessions: [] } as never
    }

    if (method === 'runtime.describe') {
      return { capabilities: ['work-code-handoff-v1'] } as never
    }

    if (method === 'session.create') {
      return {
        session_id: childId,
        stored_session_id: childId,
        message_count: 0,
        messages: [],
        info: { execution_mode: params?.execution_mode, handoff: params?.handoff }
      } as never
    }

    throw new Error(`Unexpected RPC ${method}`)
  })
})
afterEach(() => {
  cleanup()
  disposePrimary?.()
  disposePrimary = undefined
  $sessionTiles.set([])
  $sessionStates.set({})
  $layoutTree.set(null)
  $activeTreeGroup.set(null)
  vi.unstubAllGlobals()
})

it.each(['work', 'code'] as const)(
  'hands off a %s tile from its real pane header with its own model and owner',
  async sourceMode => {
    mode = sourceMode
    render(
      <MemoryRouter>
        <TreeGroup node={node} parentAxis="row" />
      </MemoryRouter>
    )

    const trigger = await screen.findByRole('button', {
      name: sourceMode === 'work' ? 'Continue in Code' : 'Continue in Work'
    })

    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(trigger)
    expect(((await screen.findByLabelText('Summary')) as HTMLTextAreaElement).value).toBe('Tile goal')
    expect(screen.getByText(/Retained model: tile-model/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
    await waitFor(() => expect($sessionResumeRequest.get()?.sessionId).toBe(childId))
    const creates = vi.mocked(requestGatewayForAgent).mock.calls.filter(call => call[2] === 'session.create')
    expect(creates).toHaveLength(1)
    expect(creates[0]?.slice(0, 2)).toEqual([owner.connectionId, owner.profile])
    expect(creates[0]?.[3]).toMatchObject({
      model: 'tile-model',
      provider: 'custom:tile',
      profile: owner.targetProfile,
      reasoning_effort: 'high',
      fast: true,
      execution_mode: sourceMode === 'work' ? 'code' : 'work',
      handoff: { source_session_id: runtimeId, summary: 'Tile goal' }
    })

    if (sourceMode === 'work') {
      expect(getCustomEndpoints).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: owner.connectionId, profile: owner.targetProfile })
      )
      expect(creates[0]?.[3]).toMatchObject({ row_cwd: '' })
      expect(creates[0]?.[3]).not.toHaveProperty('cwd')
    }

    expect(takeSessionDraft(tileId).text).toBe('Unsent tile text')
    expect($currentModel.get()).toBe('primary-model')
    expect(takeSessionDraft(childId).text).toBe('Tile goal')
  }
)

async function reviewTile() {
  render(
    <MemoryRouter>
      <TreeGroup node={node} parentAxis="row" />
    </MemoryRouter>
  )
  const trigger = await screen.findByRole('button', { name: 'Continue in Code' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  await screen.findByLabelText('Summary')
}

it.each(['model', 'owner'])('refuses changed tile %s after review without creating or navigating', async drift => {
  await reviewTile()
  act(() => {
    if (drift === 'model') {
      $sessionStates.set({ [runtimeId]: { ...$sessionStates.get()[runtimeId], model: 'changed-tile-model' } })
    } else {
      $sessionTiles.set([{ storedSessionId: tileId, runtimeId, ownerRoute: { ...owner, connectionId: 'other-owner' } }])
    }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await screen.findByText(/The conversation, owner or model changed/)
  expect(vi.mocked(requestGatewayForAgent).mock.calls.some(call => call[2] === 'session.create')).toBe(false)
  expect($sessionResumeRequest.get()).toBeNull()
  expect(takeSessionDraft(childId).text).toBe('')
})

it('does not borrow primary model changes while a tile review is open', async () => {
  await reviewTile()
  setCurrentModelTransient('new-primary-model')
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await waitFor(() => expect($sessionResumeRequest.get()?.sessionId).toBe(childId))
  const created = vi.mocked(requestGatewayForAgent).mock.calls.find(call => call[2] === 'session.create')
  expect(created?.[3]).toMatchObject({ model: 'tile-model', provider: 'custom:tile' })
  expect($currentModel.get()).toBe('new-primary-model')
})

async function createFromRetainedTile() {
  const primary = group(['workspace'], { id: 'primary-zone', active: 'workspace' })
  disposePrimary = registry.register({
    area: 'panes',
    id: 'workspace',
    title: 'Primary',
    data: { placement: 'main' },
    render: () => null
  })
  $layoutTree.set(split('row', [primary, node]))
  const initial = vi.mocked(requestGatewayForAgent).getMockImplementation()!
  let created = false
  let finishRefresh!: (value: unknown) => void
  vi.mocked(requestGatewayForAgent).mockImplementation(async (...args) => {
    if (args[2] === 'session.info' && created) {
      return new Promise(resolve => {
        finishRefresh = resolve
      })
    }

    const result = await initial(...args)

    if (args[2] === 'session.create') {
      created = true
    }

    return result
  })
  render(
    <MemoryRouter>
      <TreeGroup node={primary} parentAxis="row" />
      <div data-testid="retained-source-tile">
        <TreeGroup node={node} parentAxis="row" />
      </div>
    </MemoryRouter>
  )
  const tile = within(screen.getByTestId('retained-source-tile'))
  const trigger = await tile.findByRole('button', { name: 'Continue in Code' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  await screen.findByLabelText('Summary')
  fireEvent.click(screen.getByRole('button', { name: 'Create linked conversation' }))
  await waitFor(() => expect($sessionResumeRequest.get()?.sessionId).toBe(childId))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // Route resume replaces primary, not the still-mounted source in the other split.
  act(() => {
    setSelectedStoredSessionId(childId)
    setActiveSessionId(childId)
    $activeTreeGroup.set(primary.id)
  })
  await waitFor(() => expect(finishRefresh).toBeTypeOf('function'))

  return { tile, finishRefresh }
}

it('refreshes a retained source tile from its owner and exposes only the backend-proven child link', async () => {
  const { tile, finishRefresh } = await createFromRetainedTile()
  expect(tile.queryByRole('button', { name: 'Linked conversation' })).toBeNull()
  await act(async () =>
    finishRefresh({
      execution_mode: 'work',
      linked_sessions: [
        { session_id: childId, title: 'Verified Code child', execution_mode: 'code', relation: 'child' }
      ]
    })
  )
  fireEvent.keyDown(await tile.findByRole('button', { name: 'Linked conversation' }), { key: 'Enter' })
  const link = await screen.findByRole('menuitem', { name: /Verified Code child/ })
  act(() => $sessionResumeRequest.set(null))
  fireEvent.click(link)
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: childId, ownerRoute: owner })
  const reads = vi.mocked(requestGatewayForAgent).mock.calls.filter(call => call[2] === 'session.info')
  expect(reads).toHaveLength(2)

  for (const read of reads) {
    expect(read.slice(0, 4)).toEqual([owner.connectionId, owner.profile, 'session.info', { session_id: runtimeId }])
  }

  expect(takeSessionDraft(tileId).text).toBe('Unsent tile text')
  expect(takeSessionDraft(childId).text).toBe('Tile goal')
  expect(vi.mocked(requestGatewayForAgent).mock.calls.some(call => call[2] === 'prompt.submit')).toBe(false)
})

it('discards a retained tile link refresh if its owner changes before the reply', async () => {
  const { tile, finishRefresh } = await createFromRetainedTile()
  const resume = $sessionResumeRequest.get()
  act(() =>
    $sessionTiles.set([
      { storedSessionId: tileId, runtimeId, ownerRoute: { ...owner, targetProfile: 'other-profile' } }
    ])
  )
  await act(async () =>
    finishRefresh({
      execution_mode: 'work',
      linked_sessions: [
        { session_id: childId, title: 'Previous owner child', execution_mode: 'code', relation: 'child' }
      ]
    })
  )
  fireEvent.keyDown(await tile.findByRole('button', { name: 'Linked conversation' }), { key: 'Enter' })
  expect(screen.queryByRole('menuitem', { name: /Previous owner child/ })).toBeNull()
  expect($sessionResumeRequest.get()).toBe(resume)
  expect(vi.mocked(requestGatewayForAgent).mock.calls.some(call => call[2] === 'prompt.submit')).toBe(false)
})
