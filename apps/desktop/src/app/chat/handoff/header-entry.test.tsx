import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { WorkspaceHeaderMenu } from '@/app/chat/session-tile'
import { openSession } from '@/app/open-session'
import { group } from '@/components/pane-shell/tree/model'
import { WindowTitlebarContext } from '@/components/pane-shell/tree/renderer/header-placement'
import { TreeGroup } from '@/components/pane-shell/tree/renderer/tree-group'
import { Slot } from '@/contrib/react/slot'
import { registry } from '@/contrib/registry'
import { requestGatewayForAgent } from '@/store/gateway'
import { platformModelCatalog } from '@/store/platform-models'
import {
  forgetSessionOwnerHintsForSession,
  setActiveSessionId,
  setSelectedStoredSessionId,
  setSessionOwnerHint,
  setSessions
} from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformSnapshot } from '@/test/platform-model'
import { makeSessionInfo } from '@/test/session-info'

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn()
}))

let dispose: () => void

beforeEach(() => {
  vi.clearAllMocks()
  stubResizeObserver()
  stubMenuDomApis()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  setSessions([
    makeSessionInfo({ id: 'code-physical', title: 'Implementation', connection_id: 'fixture', profile: 'default' })
  ])
  forgetSessionOwnerHintsForSession('code-physical')
  setSessionOwnerHint('code-physical', { connectionId: 'fixture', profile: 'default' })
  setSelectedStoredSessionId('code-physical')
  setActiveSessionId('code-logical')
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ execution_mode: 'code', linked_sessions: [] } as never)
  dispose = registry.register({
    area: 'panes',
    id: 'workspace',
    title: 'Implementation',
    data: { placement: 'main', uncloseable: true, headerMenu: () => <WorkspaceHeaderMenu /> },
    render: () => null
  })
})

afterEach(() => {
  cleanup()
  dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mountHeader() {
  render(
    <MemoryRouter>
      <WindowTitlebarContext.Provider value>
        <div data-testid="window-titlebar">
          <Slot area="titleBar.left" />
        </div>
        <TreeGroup node={group(['workspace'], { id: 'primary' })} parentAxis="row" />
      </WindowTitlebarContext.Provider>
    </MemoryRouter>
  )

  return within(screen.getByTestId('window-titlebar'))
}

it('opens reviewed Code → Work handoff from the actual desktop window session header', async () => {
  const titlebar = mountHeader()
  const trigger = await titlebar.findByRole('button', { name: 'Continue in Work' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  expect(await screen.findByRole('dialog', { name: 'Review handoff' })).toBeTruthy()
  expect(screen.getByLabelText('Summary')).toBeTruthy()
  expect(vi.mocked(requestGatewayForAgent).mock.calls[0]?.slice(0, 4)).toEqual([
    'fixture',
    'default',
    'session.info',
    { session_id: 'code-logical' }
  ])
})

it('recovers metadata after the same session is reopened while its first read is pending', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(requestGatewayForAgent).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const titlebar = mountHeader()
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  act(() => openSession('code-physical', vi.fn(), 'main'))
  await act(async () => finish({ execution_mode: 'code', linked_sessions: [] }))
  const trigger = await titlebar.findByRole('button', { name: 'Continue in Work' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  expect(await screen.findByRole('dialog', { name: 'Review handoff' })).toBeTruthy()
  expect(vi.mocked(requestGatewayForAgent).mock.calls.every(call => call[2] === 'session.info')).toBe(true)
})

it.each(['owner', 'account'] as const)(
  'rejects pending metadata after same-ID reopen under a changed %s',
  async drift => {
    let finish!: (value: unknown) => void
    const account = vi.spyOn(platformModelCatalog().account, 'get').mockReturnValue(platformSnapshot())
    vi.mocked(requestGatewayForAgent).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const titlebar = mountHeader()
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    act(() => {
      openSession('code-physical', vi.fn(), 'main')

      if (drift === 'owner') {
        forgetSessionOwnerHintsForSession('code-physical')
        setSessionOwnerHint('code-physical', { connectionId: 'other-owner', profile: 'default' })
      } else {
        account.mockReturnValue(platformSnapshot('other-user', 2))
      }
    })
    await act(async () =>
      finish({
        execution_mode: 'code',
        linked_sessions: [
          { session_id: 'old-owner-work', title: 'Old owner Work', execution_mode: 'work', relation: 'source' }
        ]
      })
    )
    expect((titlebar.getByRole('button', { name: 'Continue in Code' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(await titlebar.findByRole('button', { name: 'Linked conversation' }), { key: 'Enter' })
    expect(screen.queryByRole('menuitem', { name: /Old owner Work/ })).toBeNull()
    expect(vi.mocked(requestGatewayForAgent).mock.calls.every(call => call[2] === 'session.info')).toBe(true)
  }
)
