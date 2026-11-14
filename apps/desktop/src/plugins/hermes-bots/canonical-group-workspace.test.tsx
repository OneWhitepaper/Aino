import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
const respondModels = vi.hoisted(() => vi.fn())
vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const gateway = createGroupGateway()
  const { en } = await import('@/i18n/en')
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')
  const { ConfirmDialog } = await import('@/components/ui/confirm-dialog')
  const { captureGroupRequests } = await import('./canonical-group-contract-test-utils')
  const { useLayoutEffect } = await import('react')

  return {
    ...(await pluginSdkMock(gateway.host)),
    respondPluginGroupModelRequests: respondModels,
    atom,
    useValue: useStore,
    // This suite exercises the desktop layout; browser tests verify its geometry.
    useResizeObserver: (callback: (entries: readonly ResizeObserverEntry[]) => void) => {
      useLayoutEffect(() => callback([{ contentRect: { width: 1440 } } as ResizeObserverEntry]), [callback])
    },
    ConfirmDialog,
    useQuery: (await import('@tanstack/react-query')).useQuery,
    useI18n: () => ({ t: en }),
    usePluginI18n: () => (key: string) =>
      CANONICAL_GROUP_LOCALES.en[key.replace('canonical.', '') as keyof typeof CANONICAL_GROUP_LOCALES.en] ?? key,
    Button: (p: ComponentProps<'button'>) => <button {...p} />,
    Input: (p: ComponentProps<'input'>) => <input {...p} />,
    RowButton: (p: ComponentProps<'button'>) => <button type="button" {...p} />,
    host: { ...gateway.host, requestProfile: captureGroupRequests(request).request }
  }
})
import { host } from '@hermes/plugin-sdk'

import {
  CANONICAL_GROUP_CAPABILITIES,
  LEGACY_STANDALONE_GROUP_CAPABILITIES,
  STANDALONE_GROUP_CAPABILITIES
} from './canonical-group-contract-test-utils'
import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import { $canonicalGroupBindings, registerCanonicalGroup } from './canonical-group-registry'
import { prepareCanonicalGroupSend, readCanonicalGroupSend } from './canonical-group-send'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
import { renderGatewayRooms } from './gateway-group-rooms-test-harness'
import { $groupChatWorkspace } from './group-chat'
import { copyGroupMentions, GROUP_MENTION_CLIPBOARD_TYPE } from './group-chat-mention-clipboard'
import { projectGroupMentions } from './group-chat-mentions'
import { GroupChatWorkspace } from './group-chat-view'
import { clearGroupComposerDrafts } from './group-panes'
const originalDesktop = window.hermesDesktop
beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, writable: true, value: undefined })
})
afterEach(() => {
  cleanup()
  clearGroupComposerDrafts()
  vi.useRealTimers()
  request.mockReset()
  respondModels.mockReset()
  localStorage.clear()
  window.hermesDesktop = originalDesktop
  vi.unstubAllGlobals()
})

// What gateway/session_group_controls.py answers for groups.send.
const receipt = (params: { event_id?: string }) => ({
  event: {},
  client_event_id: params.event_id,
  accepted: true,
  driver_started: true
})

it('preserves the unsent draft when only the room display name changes', async () => {
  const name = 'Room'
  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Room' }, driver_status: {} }
      : method === 'groups.log'
        ? { events: [] }
        : {}
  )
  const binding = { connectionId: 'local', profile: 'team', roomId: 'rename', roomName: 'Room' }
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  expect(screen.getByTitle(name).textContent).toBe(name)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this draft' } })
  view.rerender(<CanonicalGroupWorkspace binding={{ ...binding, roomName: 'Renamed room' }} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this draft')

  view.rerender(<CanonicalGroupWorkspace binding={{ ...binding, roomId: 'another-room' }} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
})

it('restores a frozen send after remount and retires only its acknowledged exact retry', async () => {
  const binding = { connectionId: 'remote', profile: 'team', roomId: 'restore' }

  const entry = await prepareCanonicalGroupSend(binding, {
    text: 'Original',
    attachments: [{ path: '/owner/image.png', mime_type: 'image/png' }]
  })

  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room: { name: 'Room' }, driver_status: {} }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.send') {
      throw new Error('lost ACK')
    }

    return {}
  })
  const first = render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Original'))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
  expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('lost ACK')
  // The request was counted before it left, so this intent stays uncertain until a receipt.
  expect(await readCanonicalGroupSend(binding)).toEqual({ ...entry, attempts: 1 })
  first.unmount()
  render(<CanonicalGroupWorkspace binding={binding} />)
  await screen.findByRole('button', { name: 'Retry' })
  request.mockImplementation(async (_route, method, params) =>
    method === 'groups.state'
      ? { room: { name: 'Room' }, driver_status: {} }
      : method === 'groups.log'
        ? { events: [] }
        : receipt(params)
  )
  await waitFor(() => expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(async () => expect(await readCanonicalGroupSend(binding)).toBeUndefined())
  const sends = request.mock.calls.filter(c => c[1] === 'groups.send')
  expect(sends).toHaveLength(2)

  for (const call of sends) {
    expect(call[0]).toMatchObject({ connectionId: binding.connectionId, targetProfile: binding.profile })
    expect(call[2]).toEqual({ ...entry.params, profile: binding.profile })
  }
})

it('blocks Send until journal restore and durable preparation complete', async () => {
  let releaseRead!: (value: string) => void
  let releaseWrite!: () => void
  const journal: Record<string, unknown> = {}

  const native = {
    read: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>(resolve => {
            releaseRead = resolve
          })
      )
      .mockImplementation(async () => JSON.stringify(journal)),
    compareAndSet: vi.fn(async (key: string, _expected: string | null, value: string | null) => {
      await new Promise<void>(resolve => {
        releaseWrite = resolve
      })

      if (value === null) {
        delete journal[key]
      } else {
        journal[key] = JSON.parse(value)
      }

      return { applied: true, current: value }
    })
  }

  window.hermesDesktop = { preparedSubmissions: native } as unknown as typeof window.hermesDesktop
  request.mockImplementation(async (_route, method, params) =>
    method === 'groups.state'
      ? { room: { name: 'Room' }, driver_status: {} }
      : method === 'groups.log'
        ? { events: [] }
        : receipt(params)
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'new' }} />)
  await screen.findByText('Room')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New text' } })
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  releaseRead('{}')
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New text' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(native.compareAndSet).toHaveBeenCalled())
  expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(false)
  releaseWrite()
  // The dispatch is recorded durably before the request leaves.
  await waitFor(() => expect(native.compareAndSet).toHaveBeenCalledTimes(2))
  expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(false)
  releaseWrite()
  await waitFor(() => expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(true))
  await waitFor(() => expect(native.compareAndSet).toHaveBeenCalledTimes(3))
  releaseWrite()
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''))
})

it('captures exact pending attempts through confirmation and never retargets or retries unknown work', async () => {
  const action = { kind: 'discard', member_id: 'worker', task_id: 'old-task', execution_generation: 7 }
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room: { name: 'Room' }, driver_status: { pending_actions: [action] } }
    }

    if (method === 'groups.log') {
      return { events: [], has_more: false }
    }

    if (method === 'groups.discard') {
      throw new Error('stale_attempt')
    }

    return {}
  })
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'ack-room' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(screen.getByText(/Side effects may already have occurred/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  action.execution_generation = 8
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }))
  await within(screen.getByRole('dialog')).findByText('stale_attempt')
  const call = request.mock.calls.find(c => c[1] === 'groups.discard')!
  expect(call[0]).toMatchObject({ connectionId: 'remote', targetProfile: 'team' })
  expect(call[2]).toEqual({
    room_id: 'ack-room',
    member_id: 'worker',
    task_id: 'old-task',
    execution_generation: 7,
    profile: 'team'
  })
  expect(request.mock.calls.every(c => c[1].startsWith('groups.'))).toBe(true)
})

it('reads back retry on the same authority and sends only through the group driver', async () => {
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return {
        room: { name: 'Room' },
        driver_status: { pending_actions: [{ kind: 'retry', member_id: 'w', task_id: 't', execution_generation: 2 }] }
      }
    }

    if (method === 'groups.log') {
      return { events: [{ seq: 1, kind: 'message', payload: { text: 'Owner reply' } }], has_more: false }
    }

    return {}
  })

  const group = registerCanonicalGroup(
    { connectionId: 'local', profile: 'default' },
    { room_id: 'r', name: 'Room', members: [] }
  )

  render(<GroupChatWorkspace group={group} members={[]} origin="key" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(request.mock.calls.filter(c => c[1] === 'groups.state').length).toBeGreaterThan(1))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(true))
  expect(screen.getByText('Owner reply')).toBeTruthy()
  expect(request.mock.calls.every(c => c[1].startsWith('groups.'))).toBe(true)
})

// Review 5475590057 P3: another window won the room's one intent slot after this one restored.
// Send converges on that durable winner (4149282e49) but this window's typed text is kept, not lost.
it("a Send that converges on another window's pending intent keeps this window's draft", async () => {
  const binding = { connectionId: 'remote', profile: 'team', roomId: 'two-windows' }
  request.mockImplementation(async (_route, method, params) =>
    method === 'groups.state'
      ? { room: { name: 'Room' }, driver_status: {} }
      : method === 'groups.log'
        ? { events: [] }
        : receipt(params)
  )
  render(<CanonicalGroupWorkspace binding={binding} />)
  await screen.findByText('Room')
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  const other = await prepareCanonicalGroupSend(binding, { text: 'from the other window', attachments: [] })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed here' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(async () => expect(await readCanonicalGroupSend(binding)).toBeUndefined())
  expect(request.mock.calls.filter(c => c[1] === 'groups.send').map(c => c[2])).toEqual([
    { ...other.params, profile: 'team' }
  ])
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('typed here'))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)
})

it('shows which bots are working, and still says the group is working on a gateway without member activity', async () => {
  const members = [
    { member_id: 'ops', profile: 'ops', handle: 'ops', display_name: 'Ops' },
    { member_id: 'qa', profile: 'qa', handle: 'qa', display_name: 'QA' }
  ]

  let driver: Record<string, unknown> = {
    working: true,
    member_activity: [
      { member_id: 'qa', status: 'queued' },
      { member_id: 'ops', status: 'running' },
      { member_id: 'ops', status: 'queued' }
    ]
  }

  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Room', members }, driver_status: driver }
      : method === 'groups.log'
        ? { events: [] }
        : {}
  )
  const view = render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'busy' }} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Ops · Working1 members queued'))
  fireEvent.click(screen.getByRole('button', { name: 'Group info' }))

  const phase = (name: string) =>
    within(screen.getByRole('list', { name: 'Members' }))
      .getByText(name)
      .closest('li')
      ?.getAttribute('data-phase')

  expect([phase('Ops'), phase('QA')]).toEqual(['working', 'queued'])

  // The same mounted room clears both indicators on its next poll once the turn settles.
  driver = { working: false, member_activity: [] }
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 5_000 })
  expect([phase('Ops'), phase('QA')]).toEqual(['idle', 'idle'])

  view.unmount()
  driver = { working: true }
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'older' }} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The group is working…'))
})

const roomReads =
  (members: unknown[] = [], events: unknown[] = []) =>
  (method: string) =>
    method === 'groups.state'
      ? { room: { name: 'Room', members }, driver_status: {} }
      : method === 'groups.log'
        ? { events }
        : undefined

it('answers model requests while a group is hidden without reloading its transcript', async () => {
  const members = [{ member_id: 'm1', profile: 'helper', handle: 'helper', display_name: 'Helper' }]

  const pending = [
    { request_id: 'request-1', session_id: 'private-group-session', member_id: 'm1', profile: 'helper', action: 'list' }
  ]

  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Room', members }, model_requests: pending, driver_status: { working: true } }
      : { events: [] }
  )
  render(
    <CanonicalGroupWorkspace
      binding={{ connectionId: 'remote', profile: 'team', roomId: 'background-models' }}
      visible={false}
    />
  )
  await waitFor(() => expect(respondModels).toHaveBeenCalledOnce())
  expect(respondModels).toHaveBeenCalledWith(
    expect.objectContaining({ connectionId: 'remote', profile: 'team', targetProfile: 'team' }),
    expect.any(Function),
    'background-models',
    members,
    pending
  )
  expect(request.mock.calls.some(call => call[1] === 'groups.log')).toBe(false)
})

it('updates active status within a second without rereading unchanged history, then returns to idle polling', async () => {
  vi.useFakeTimers()
  let latestSeq = 1
  let driver = { working: true, member_activity: [{ member_id: 'helper', status: 'running' }] }
  const events = [{ seq: 1, event_id: 'first', kind: 'message.member', payload: { text: 'Retained reply' } }]
  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? {
          room: {
            name: 'Room',
            latest_seq: latestSeq,
            members: [{ member_id: 'helper', profile: 'helper', handle: 'helper', display_name: 'Helper' }]
          },
          driver_status: driver
        }
      : { events: [...events] }
  )

  await act(async () => {
    render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'live-status' }} />)
  })
  expect(screen.getByText('Retained reply')).toBeTruthy()
  driver = { working: true, member_activity: [{ member_id: 'helper', status: 'stopping' }] }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(screen.getByRole('status').textContent).toContain('Stopping')
  expect(request.mock.calls.filter(call => call[1] === 'groups.log')).toHaveLength(1)
  expect(screen.getByText('Retained reply')).toBeTruthy()

  latestSeq = 2
  events.push({ seq: 2, event_id: 'second', kind: 'message.member', payload: { text: 'New reply' } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(screen.getByText('New reply')).toBeTruthy()
  expect(request.mock.calls.filter(call => call[1] === 'groups.log')).toHaveLength(2)

  driver = { working: false, member_activity: [] }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(screen.queryByRole('status')).toBeNull()
  const readsAtIdle = request.mock.calls.filter(call => call[1] === 'groups.state').length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(request.mock.calls.filter(call => call[1] === 'groups.state')).toHaveLength(readsAtIdle)
  expect(request.mock.calls.filter(call => call[1] === 'groups.log')).toHaveLength(2)
})

it('describes only a send restored from the journal as restored, never an ordinary in-flight send', async () => {
  let ack!: () => void
  request.mockImplementation(
    async (_route, method, params) =>
      roomReads()(method) ??
      (method === 'groups.send'
        ? new Promise(resolve => {
            ack = () => resolve(receipt(params))
          })
        : {})
  )

  const view = render(
    <CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'ordinary' }} />
  )

  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(true))
  expect(screen.queryByText(/unconfirmed send was restored/)).toBeNull()
  await act(async () => ack())
  view.unmount()

  const binding = { connectionId: 'remote', profile: 'team', roomId: 'restored' }
  await prepareCanonicalGroupSend(binding, { text: 'Left over', attachments: [] })
  render(<CanonicalGroupWorkspace binding={binding} />)
  await screen.findByText(/unconfirmed send was restored/)
})

it('drops the restored notice once the gateway proves the restored send posted nothing', async () => {
  const refusal = Object.assign(new Error('hosted room not found'), { code: 4111, data: { admitted: false } })
  request.mockImplementation(
    async (_route, method) => roomReads()(method) ?? (method === 'groups.send' ? Promise.reject(refusal) : {})
  )
  const binding = { connectionId: 'remote', profile: 'team', roomId: 'restored-refused' }
  await prepareCanonicalGroupSend(binding, { text: 'Left over', attachments: [] })
  render(<CanonicalGroupWorkspace binding={binding} />)
  await screen.findByText(/unconfirmed send was restored/)
  const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement
  await waitFor(() => expect(retry.disabled).toBe(false))
  fireEvent.click(retry)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  expect(screen.queryByText(/unconfirmed send was restored/)).toBeNull()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Left over')
})

it("renames the room and disbands it only through ConfirmDialog, which stays open with a failed disband's error", async () => {
  const onBack = vi.fn()
  let disbands = 0
  request.mockImplementation(
    async (_route, method) =>
      roomReads()(method) ??
      (method === 'groups.disband'
        ? ++disbands === 1
          ? Promise.reject(new Error('disband failed'))
          : { tombstone: { room_id: 'controls', disbanded_at: 1 } }
        : {})
  )
  render(
    <CanonicalGroupWorkspace
      binding={{ connectionId: 'remote', profile: 'team', roomId: 'controls' }}
      onBack={onBack}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Group info' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename' }).at(-1)!)
  fireEvent.change(screen.getByRole('textbox', { name: 'New name' }), { target: { value: ' Renamed ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(request.mock.calls.find(c => c[1] === 'groups.rename')?.[2]).toMatchObject({
      room_id: 'controls',
      name: 'Renamed'
    })
  )
  const disband = screen.getByRole('button', { name: /disband/i }) as HTMLButtonElement
  await waitFor(() => expect(disband.disabled).toBe(false))
  fireEvent.click(disband)
  expect(request.mock.calls.some(c => c[1] === 'groups.disband')).toBe(false)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /disband/i }))
  await within(dialog).findByText(/The group chat has been kept/)
  expect(onBack).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /disband/i }))
  await waitFor(() => expect(onBack).toHaveBeenCalledOnce())
  expect(request.mock.calls.filter(c => c[1] === 'groups.disband').map(c => c[2])).toEqual([
    expect.objectContaining({ room_id: 'controls', cancel_id: expect.any(String) }),
    expect.objectContaining({ room_id: 'controls' })
  ])
})

it('leaves the in-panel room after a disband even though no tab supplies onBack', async () => {
  request.mockImplementation(
    async (_route, method) =>
      roomReads()(method) ?? (method === 'groups.disband' ? { tombstone: { room_id: 'panel', disbanded_at: 1 } } : {})
  )

  const group = registerCanonicalGroup(
    { connectionId: 'local', profile: 'default' },
    { room_id: 'panel', name: 'Room', members: [] }
  )

  $groupChatWorkspace.set(group)
  render(<GroupChatWorkspace group={group} members={[]} origin="key" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Group info' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  const disband = (await screen.findByRole('button', { name: /disband/i })) as HTMLButtonElement
  await waitFor(() => expect(disband.disabled).toBe(false))
  fireEvent.click(disband)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /disband/i }))
  await waitFor(() => expect($groupChatWorkspace.get()).toBeNull())
})

it('drops a disbanded room from the sidebar list and its bindings, with the disbanded toast', async () => {
  vi.mocked(host.notify).mockClear()
  let disbanded = false
  const room = { room_id: 'gone', name: 'Doomed', members: [] }
  request.mockImplementation(async (_route, method) =>
    method === 'groups.disband'
      ? ((disbanded = true), { tombstone: { room_id: 'gone', disbanded_at: 1 } })
      : method === 'groups.capabilities'
        ? { driver: true }
        : method === 'groups.list'
          ? { rooms: disbanded ? [] : [room], next_offset: null }
          : (roomReads()(method) ?? {})
  )
  renderGatewayRooms()
  await screen.findByRole('button', { name: 'Doomed' })
  const binding = { connectionId: 'local', profile: 'default', roomId: 'gone', roomName: 'Doomed' }
  const key = registerCanonicalGroup(binding, room)
  render(<CanonicalGroupWorkspace binding={binding} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Group info' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  const disband = (await screen.findByRole('button', { name: /disband/i })) as HTMLButtonElement
  await waitFor(() => expect(disband.disabled).toBe(false))
  fireEvent.click(disband)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /disband/i }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Doomed' })).toBeNull())
  expect($canonicalGroupBindings.get()[key]).toBeUndefined()
  expect(host.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'success', message: 'Disbanded “Room”' })
})

it('@-completes room members with the exact handle the gateway resolves', async () => {
  request.mockImplementation(
    async (_route, method) =>
      roomReads([{ member_id: 'm1', profile: 'ops', handle: 'ops-2', display_name: 'Ops Bot' }])(method) ?? {}
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'mentions' }} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@' } })
  expect(screen.getByRole('option', { name: /Everyone/ })).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@op' } })
  expect(screen.getByRole('option', { name: /Ops Bot/ })).toBeTruthy()
  fireEvent.mouseDown(screen.getByRole('option', { name: /Ops Bot/ }))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('@Ops Bot ')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(request.mock.calls.some(call => call[1] === 'groups.send' && call[2]?.payload?.text === '@ops-2 ')).toBe(
      true
    )
  )
})

it('blocks unbound names through Enter and form submit, then sends the member chosen from the picker', async () => {
  const members = [{ member_id: 'm1', profile: 'ops', handle: 'u6d4b', display_name: '测试' }]
  request.mockImplementation(async (_route, method) => roomReads(members)(method) ?? {})
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'safe-mention' }} />)
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(input.disabled).toBe(false))
  fireEvent.change(input, { target: { value: '@测试 请检查' } })
  expect(screen.getByRole('alert').textContent).toMatch(/not linked/)
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.submit(input.closest('form')!)
  expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(false)
  expect(input.value).toBe('@测试 请检查')

  fireEvent.change(input, { target: { value: '@测' } })
  fireEvent.mouseDown(screen.getByRole('option', { name: /测试/ }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() =>
    expect(request.mock.calls.some(call => call[1] === 'groups.send' && call[2].payload.text === '@u6d4b ')).toBe(true)
  )
})

it('retains two identically named recipients and reports punctuation-adjacent delivery correctly', async () => {
  const members = [
    { member_id: 'a', profile: 'a', handle: 'a', display_name: '设计师' },
    { member_id: 'b', profile: 'b', handle: 'b', display_name: '设计师' }
  ]

  request.mockImplementation(async (_route, method) => roomReads(members)(method) ?? {})

  const { container } = render(
    <CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'same-name' }} />
  )

  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(input.disabled).toBe(false))
  fireEvent.change(input, { target: { value: '(@a) hello a@b' } })
  expect(container.querySelector('.aino-group-recipients')?.textContent).toBe('Mentioned: 设计师 ×2')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(
      request.mock.calls.some(call => call[1] === 'groups.send' && call[2].payload.text === '(@a) hello a@b')
    ).toBe(true)
  )
})

it('restores only same-room clipboard recipients and blocks a foreign name that collides with a local handle', async () => {
  const members = [
    { member_id: 'a', profile: 'a', handle: 'frozen-a', display_name: 'b' },
    { member_id: 'b', profile: 'b', handle: 'b', display_name: 'Other member' }
  ]

  request.mockImplementation(async (_route, method) => roomReads(members)(method) ?? {})
  const binding = { connectionId: 'local', profile: 'team', roomId: 'paste-safe' }
  render(<CanonicalGroupWorkspace binding={binding} />)
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(input.disabled).toBe(false))
  const identities = members.map(member => ({ handle: member.handle, label: member.display_name }))
  const projection = projectGroupMentions('@frozen-a ', identities)
  const scope = JSON.stringify(['canonical', binding.connectionId, binding.profile, binding.roomId])

  const copy = (scope: string) => {
    const copied = copyGroupMentions(projection, 0, projection.text.length, scope)

    return {
      files: [],
      getData: (type: string) =>
        type === 'text/plain' ? copied.text : type === GROUP_MENTION_CLIPBOARD_TYPE ? (copied.envelope ?? '') : ''
    }
  }

  fireEvent.paste(input, { clipboardData: copy('another-room') })
  expect(input.value).toBe('＠b ')
  expect(screen.getByRole('alert').textContent).toMatch(/another group/)
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.submit(input.closest('form')!)
  expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(false)
  input.setSelectionRange(0, input.value.length)
  fireEvent.paste(input, { clipboardData: copy(scope) })
  expect(input.value).toBe('@b ')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(request.mock.calls.some(call => call[1] === 'groups.send' && call[2].payload.text === '@frozen-a ')).toBe(
      true
    )
  )
})

it('retries already journaled bytes even when their old member is unavailable', async () => {
  const binding = { connectionId: 'local', profile: 'team', roomId: 'old-member-retry' }
  const entry = await prepareCanonicalGroupSend(binding, { text: '@removed original payload', attachments: [] })
  request.mockImplementation(async (_route, method) => roomReads()(method) ?? {})
  render(<CanonicalGroupWorkspace binding={binding} />)
  const retry = await screen.findByRole('button', { name: 'Retry' })
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(retry)
  await waitFor(() =>
    expect(
      request.mock.calls.some(call => call[1] === 'groups.send' && call[2].payload.text === entry.params.payload.text)
    ).toBe(true)
  )
})

it('uploads pasted and dropped files through the room upload and previews committed images inline', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const image = { attachment_id: 'img', kind: 'image', name: 'shot.png', mime: 'image/png', size: 1 }
  const large = { ...image, attachment_id: 'large', name: 'large.png', size: 6 * 1024 * 1024 }

  const events = [
    { seq: 1, room_id: 'paste', event_id: 'e1', kind: 'message.member', payload: { attachments: [image, large] } }
  ]

  request.mockImplementation(
    async (_route, method, params) =>
      roomReads([], events)(method) ??
      (method === 'groups.attachment.upload'
        ? { attachment_id: `att-${params.name}`, kind: params.kind, name: params.name, mime: params.mime, size: 1 }
        : method === 'groups.attachment.download'
          ? { ...image, data_base64: 'QQ==' }
          : {})
  )
  const observers: IntersectionObserverCallback[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'paste' }} />)
  await waitFor(() => expect(observers).toHaveLength(1))
  expect(request.mock.calls.some(c => c[1] === 'groups.attachment.download')).toBe(false)
  act(() => observers[0]([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  await waitFor(() => expect(screen.getByRole('img', { name: 'shot.png' }).getAttribute('src')).toBe('blob:preview'))
  expect(request.mock.calls.filter(c => c[1] === 'groups.attachment.download').map(c => c[2].attachment_id)).toEqual([
    'img'
  ])
  const box = screen.getByRole('textbox')
  await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false))
  fireEvent.paste(box, { clipboardData: { files: [], types: ['text/plain'], getData: () => '' } })
  fireEvent.paste(box, {
    clipboardData: { files: [new File(['a'], 'a.png', { type: 'image/png' })], types: ['Files'] }
  })
  await screen.findByText('a.png')
  fireEvent.drop(box, { dataTransfer: { files: [new File(['b'], 'b.txt', { type: 'text/plain' })], types: ['Files'] } })
  await screen.findByText('b.txt')
  expect(request.mock.calls.filter(c => c[1] === 'groups.attachment.upload').map(c => [c[2].name, c[2].kind])).toEqual([
    ['a.png', 'image'],
    ['b.txt', 'file']
  ])
})

it('re-gates previews on the observer after the room is hidden and shown, instead of refetching them all at once', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const image = { attachment_id: 'img', kind: 'image', name: 'shot.png', mime: 'image/png', size: 1 }

  const events = [
    { seq: 1, room_id: 'toggle', event_id: 'e1', kind: 'message.member', payload: { attachments: [image] } }
  ]

  request.mockImplementation(
    async (_route, method) =>
      roomReads([], events)(method) ??
      (method === 'groups.attachment.download' ? { ...image, data_base64: 'QQ==' } : {})
  )
  const observers: IntersectionObserverCallback[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )
  const downloads = () => request.mock.calls.filter(c => c[1] === 'groups.attachment.download').length
  const binding = { connectionId: 'local', profile: 'team', roomId: 'toggle' }
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect(observers).toHaveLength(1))
  act(() => observers[0]([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  await screen.findByRole('img', { name: 'shot.png' })
  view.rerender(<CanonicalGroupWorkspace binding={binding} visible={false} />)
  view.rerender(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect(observers).toHaveLength(2))
  expect(downloads()).toBe(1)
  act(() => observers[1]([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  await waitFor(() => expect(downloads()).toBe(2))
})

it('keeps automatic preview downloads bounded and never requests one file twice at once', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })

  const image = (n: number) => ({
    attachment_id: `img-${n}`,
    kind: 'image',
    name: `shot-${n}.png`,
    mime: 'image/png',
    size: 4 * 1024 * 1024
  })

  const events = Array.from({ length: 20 }, (_, n) => ({
    seq: n + 1,
    room_id: 'bound',
    event_id: `e${n}`,
    kind: 'message.member',
    payload: { attachments: [image(n)] }
  }))

  const held: Array<() => void> = []
  request.mockImplementation(
    async (_route, method) =>
      roomReads([], events)(method) ??
      (method === 'groups.attachment.download'
        ? new Promise(resolve => {
            held.push(() => resolve({ ...image(0), data_base64: 'QQ==' }))
          })
        : {})
  )
  const observers: IntersectionObserverCallback[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )

  const seen = (callback: IntersectionObserverCallback, isIntersecting: boolean) =>
    act(() => callback([{ isIntersecting }] as IntersectionObserverEntry[], {} as IntersectionObserver))

  const downloads = () =>
    request.mock.calls.filter(c => c[1] === 'groups.attachment.download').map(c => c[2].attachment_id)

  const binding = { connectionId: 'remote', profile: 'team', roomId: 'bound' }
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect(observers).toHaveLength(20))

  // A fast scroll: every preview enters and leaves the viewport before any download finishes.
  for (const callback of [...observers]) {
    seen(callback, true)
    seen(callback, false)
  }

  expect(downloads()).toEqual(['img-0', 'img-1'])
  // Hidden and shown again while img-0 is pending, with a slot free: the same file is not requested twice.
  await act(async () => {
    held[1]()
  })
  view.rerender(<CanonicalGroupWorkspace binding={binding} visible={false} />)
  view.rerender(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect(observers).toHaveLength(40))
  seen(observers[20], true)
  await act(async () => {
    await Promise.resolve()
  })
  expect(downloads()).toEqual(['img-0', 'img-1'])
  // The shared request still paints the re-shown preview, and the previews that scrolled away are never requested.
  await act(async () => {
    held.splice(0).forEach(release => release())
  })
  await screen.findByRole('img', { name: 'shot-0.png' })
  expect(downloads()).toEqual(['img-0', 'img-1'])
})

it('starts waiting previews in order as downloads succeed or fail, never more than two at once', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })

  const image = (n: number) => ({
    attachment_id: `img-${n}`,
    kind: 'image',
    name: `shot-${n}.png`,
    mime: 'image/png',
    size: 1
  })

  const events = Array.from({ length: 6 }, (_, n) => ({
    seq: n + 1,
    room_id: 'drain',
    event_id: `e${n}`,
    kind: 'message.member',
    payload: { attachments: [image(n)] }
  }))

  const held = new Map<string, (ok: boolean) => void>()
  let running = 0
  let peak = 0
  request.mockImplementation(
    async (_route, method, params) =>
      roomReads([], events)(method) ??
      (method === 'groups.attachment.download'
        ? new Promise((resolve, reject) => {
            peak = Math.max(peak, ++running)
            held.set(params.attachment_id, ok => {
              running--

              if (ok) {
                resolve({ ...image(Number(params.attachment_id.slice(4))), data_base64: 'QQ==' })
              } else {
                reject(new Error('gone'))
              }
            })
          })
        : {})
  )
  const observers: IntersectionObserverCallback[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )

  const downloads = () =>
    request.mock.calls.filter(c => c[1] === 'groups.attachment.download').map(c => c[2].attachment_id)

  const settle = (outcomes: Record<string, boolean>) =>
    act(async () => {
      Object.entries(outcomes).forEach(([id, ok]) => held.get(id)?.(ok))
    })

  render(<CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'drain' }} />)
  await waitFor(() => expect(observers).toHaveLength(6))

  // Every preview stays in view, so four wait behind the first two.
  for (const callback of observers) {
    act(() => callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  }

  await waitFor(() => expect(downloads()).toEqual(['img-0', 'img-1']))
  // A finished and a failed download each hand their slot to the next waiting preview.
  await settle({ 'img-0': true, 'img-1': false })
  await waitFor(() => expect(downloads()).toEqual(['img-0', 'img-1', 'img-2', 'img-3']))
  await settle({ 'img-3': false, 'img-2': true })
  await waitFor(() => expect(downloads()).toEqual(['img-0', 'img-1', 'img-2', 'img-3', 'img-4', 'img-5']))
  await settle({ 'img-4': true, 'img-5': true })
  await screen.findByRole('img', { name: 'shot-5.png' })
  expect(peak).toBe(2)
})

it('lets a connection whose downloads never settle stall only its own previews', async () => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const image = (id: string) => ({ attachment_id: id, kind: 'image', name: `${id}.png`, mime: 'image/png', size: 1 })

  const message = (id: string, seq: number) => ({
    seq,
    room_id: id[0],
    event_id: `e-${id}`,
    kind: 'message.member',
    payload: { attachments: [image(id)] }
  })

  request.mockImplementation(async (route, method, params) =>
    route.connectionId === 'hung'
      ? (roomReads([], [message('a0', 1), message('a1', 2)])(method) ??
        (method === 'groups.attachment.download' ? new Promise(() => {}) : {}))
      : (roomReads([], [message('b0', 1)])(method) ??
        (method === 'groups.attachment.download' ? { ...image(params.attachment_id), data_base64: 'QQ==' } : {}))
  )
  const observers: IntersectionObserverCallback[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )

  const seen = (callback: IntersectionObserverCallback) =>
    act(() => callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))

  const stuck = render(<CanonicalGroupWorkspace binding={{ connectionId: 'hung', profile: 'team', roomId: 'a' }} />)
  await waitFor(() => expect(observers).toHaveLength(2))
  observers.forEach(seen)
  stuck.unmount()
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'b' }} />)
  await waitFor(() => expect(observers).toHaveLength(3))
  seen(observers[2])
  await screen.findByRole('img', { name: 'b0.png' })
  expect(request.mock.calls.filter(c => c[1] === 'groups.attachment.download').map(c => c[2].attachment_id)).toEqual([
    'a0',
    'a1',
    'b0'
  ])
})

it('uploads a file pasted while another upload runs once that one finishes, instead of dropping it', async () => {
  let release!: () => void

  const receipt = (params: Record<string, string>) => ({
    attachment_id: `att-${params.name}`,
    kind: params.kind,
    name: params.name,
    mime: params.mime,
    size: 1
  })

  request.mockImplementation(
    async (_route, method, params) =>
      roomReads()(method) ??
      (method !== 'groups.attachment.upload'
        ? {}
        : params.name === 'first.png'
          ? new Promise(resolve => {
              release = () => resolve(receipt(params))
            })
          : receipt(params))
  )
  const uploads = () => request.mock.calls.filter(c => c[1] === 'groups.attachment.upload').map(c => c[2].name)
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'queue' }} />)
  const box = screen.getByRole('textbox')
  await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false))
  fireEvent.paste(box, {
    clipboardData: { files: [new File(['a'], 'first.png', { type: 'image/png' })], types: ['Files'] }
  })
  await waitFor(() => expect(uploads()).toEqual(['first.png']))
  fireEvent.paste(box, {
    clipboardData: { files: [new File(['b'], 'second.txt', { type: 'text/plain' })], types: ['Files'] }
  })
  await act(async () => release())
  await screen.findByText('second.txt')
  expect(screen.getByText('first.png')).toBeTruthy()
  expect(uploads()).toEqual(['first.png', 'second.txt'])
})

it.each([
  ['the gateway', CANONICAL_GROUP_CAPABILITIES, true, true],
  ['the standalone server', STANDALONE_GROUP_CAPABILITIES, false, true],
  ['an older standalone server', LEGACY_STANDALONE_GROUP_CAPABILITIES, false, false]
])('offers Discard and attachments only where %s lists them', async (_surface, capabilities, discard, attachments) => {
  const actions = [
    { kind: 'discard', member_id: 'ops', task_id: 'unknown', execution_generation: 2 },
    { kind: 'retry', member_id: 'qa', task_id: 'late', execution_generation: 1 }
  ]

  const events = [
    {
      seq: 1,
      room_id: 'surfaces',
      event_id: 'file-event',
      kind: 'message.member',
      actor: { kind: 'member', id: 'ops' },
      payload: { attachments: [{ attachment_id: 'att_1', kind: 'file', name: 'notes.txt', mime: 'text/plain' }] }
    }
  ]

  let answer!: (value: unknown) => void
  request.mockImplementation(async (_route, method) =>
    method === 'groups.capabilities'
      ? new Promise(resolve => {
          answer = resolve
        })
      : method === 'groups.state'
        ? { room: { name: 'Room' }, driver_status: { pending_actions: actions } }
        : method === 'groups.log'
          ? { events }
          : {}
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'surfaces' }} />)
  await screen.findByText('notes.txt')
  // Until the gateway says what it offers, no optional control is shown.
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull()

  answer(capabilities)
  await screen.findByRole('button', { name: 'Retry' })
  expect(Boolean(screen.queryByRole('button', { name: 'Discard' }))).toBe(discard)
  expect(Boolean(screen.queryByRole('button', { name: 'Attach files' }))).toBe(attachments)
  expect((screen.getByRole('button', { name: /^Download / }) as HTMLButtonElement).disabled).toBe(!attachments)
  // Both surfaces list groups.rename and groups.disband in Aino's management panel.
  fireEvent.click(screen.getByRole('button', { name: 'Group info' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /disband/i })).toBeTruthy()
})

it("keeps Stop and Deny while the gateway's methods cannot be read, and holds back Allow and room edits", async () => {
  const approval = {
    kind: 'approval',
    member_id: 'ops',
    task_id: 'clean',
    execution_generation: 1,
    request_id: 'r-clean',
    approval: {
      request_id: 'r-clean',
      command: 'rm -rf build',
      description: 'Clear the build folder',
      choices: ['once', 'deny']
    }
  }

  request.mockImplementation(async (_route, method) =>
    method === 'groups.capabilities'
      ? Promise.reject(new Error('request timed out'))
      : method === 'groups.state'
        ? { room: { name: 'Room' }, driver_status: { working: true, pending_actions: [approval] } }
        : method === 'groups.log'
          ? { events: [] }
          : method === 'groups.stop'
            ? { cancelled: 1 }
            : { approved: true }
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'unknown-methods' }} />)
  const card = (await screen.findByText('rm -rf build')).closest('[data-task-id]') as HTMLElement
  await waitFor(() => expect(request.mock.calls.some(c => c[1] === 'groups.capabilities')).toBe(true))
  expect(within(card).queryByRole('button', { name: 'Allow once' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  expect(screen.queryByRole('button', { name: /disband/i })).toBeNull()
  const deny = within(card).getByRole('button', { name: 'Deny' }) as HTMLButtonElement
  await waitFor(() => expect(deny.disabled).toBe(false))
  fireEvent.click(deny)
  await waitFor(() =>
    expect(request.mock.calls.filter(c => c[1] === 'groups.approve').map(c => c[2].choice)).toEqual(['deny'])
  )
  fireEvent.click(screen.getByRole('button', { name: 'Stop this round' }))
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)
})

it('hides unadvertised header actions while working and ignores pasted files', async () => {
  const methods = ['groups.capabilities', 'groups.state', 'groups.log', 'groups.send']
  request.mockImplementation(async (_route, method) =>
    method === 'groups.capabilities'
      ? { driver: true, methods }
      : method === 'groups.state'
        ? { room: { name: 'Room' }, driver_status: { working: true } }
        : (roomReads()(method) ?? {})
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'remote', profile: 'team', roomId: 'bare' }} />)
  await waitFor(() => expect(request.mock.calls.some(c => c[1] === 'groups.capabilities')).toBe(true))
  const box = screen.getByRole('textbox')
  await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false))
  expect(screen.queryByRole('button', { name: 'Stop this round' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  expect(screen.queryByRole('button', { name: /disband/i })).toBeNull()
  fireEvent.paste(box, {
    clipboardData: { files: [new File(['a'], 'a.png', { type: 'image/png' })], types: ['Files'] }
  })
  expect(request.mock.calls.some(c => c[1] === 'groups.attachment.upload')).toBe(false)
})

it('reads only new log events, and the whole log again when the room authority changes', async () => {
  // The room polls every two seconds; the test moves the clock instead of waiting.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
  const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(2_000))

  const message = (seq: number, text: string) => ({
    seq,
    kind: 'message.member',
    actor: { kind: 'member', id: 'ops' },
    payload: { text }
  })

  let epoch = 1
  let log = [message(1, 'First reply')]
  request.mockImplementation(async (_route, method, params) =>
    method === 'groups.state'
      ? { room: { name: 'Room', authority_epoch: epoch, latest_seq: log.at(-1)!.seq }, driver_status: {} }
      : method === 'groups.log'
        ? { events: log.filter(event => event.seq > params.since_seq), has_more: false }
        : {}
  )
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'long' }} />)
  await screen.findByText('First reply')
  log = [...log, message(2, 'Second reply')]
  await nextPoll()
  await screen.findByText('Second reply')
  const since = () => request.mock.calls.filter(call => call[1] === 'groups.log').map(call => call[2].since_seq)
  expect(since()).toEqual([0, 1])
  expect(screen.getAllByText(/reply$/).map(node => node.textContent)).toEqual(['First reply', 'Second reply'])

  // The new authority's log is as long as the one read: only its epoch says to read it all again.
  epoch = 2
  log = [message(1, 'Reply after a takeover'), message(2, 'Second reply after a takeover')]
  await nextPoll()
  await screen.findByText('Reply after a takeover')
  expect(since().at(-1)).toBe(0)
  expect(screen.queryByText('First reply')).toBeNull()
})

it('says what the room waits on beside the live work, never instead of it', async () => {
  const members = [
    { member_id: 'ops', profile: 'ops', handle: 'ops', display_name: 'Ops' },
    { member_id: 'qa', profile: 'qa', handle: 'qa', display_name: 'QA' }
  ]

  let driver: Record<string, unknown> | undefined = {
    running: true,
    working: true,
    blocked: true,
    member_activity: [{ member_id: 'ops', status: 'running' }],
    pending_actions: [
      { kind: 'retry', member_id: 'qa', task_id: 'failed', execution_generation: 1 },
      {
        kind: 'approval',
        member_id: 'ops',
        task_id: 'live',
        execution_generation: 1,
        request_id: 'r1',
        approval: { choices: ['deny'] }
      }
    ]
  }

  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Room', members }, driver_status: driver }
      : method === 'groups.log'
        ? { events: [] }
        : {}
  )

  const view = render(
    <CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'waiting' }} />
  )

  const approvalLink = await screen.findByRole('button', { name: '1 waiting for approval' })
  expect(approvalLink.parentElement?.textContent).toBe('Blocked · 1 waiting for approval · Needs attention: 1')
  expect(screen.getByRole('status').textContent).toContain('Ops')

  view.unmount()
  // A gateway whose driver is down sends no driver status.
  driver = undefined
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'stopped' }} />)
  await screen.findByText('This group chat isn’t available. Update or reconnect the gateway that hosts it.')
})

it.each(['none', 'send', 'retry'] as const)('scopes a failed Stop intent across %s', async next => {
  const action = { kind: 'retry', member_id: 'ops', task_id: 'task', execution_generation: 1 }
  let stops = 0
  request.mockImplementation(async (_route, method, params) => {
    if (method === 'groups.state') {
      return {
        room: { name: 'Room' },
        driver_status: {
          working: true,
          pending_actions: next === 'retry' ? [action] : []
        }
      }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.send') {
      return { client_event_id: params.event_id, accepted: true, driver_started: true }
    }

    if (method === 'groups.retry') {
      return { retried: true }
    }

    if (method === 'groups.stop') {
      if (++stops === 1) {
        throw new Error('Stop timed out')
      }

      return { cancelled: 1 }
    }

    return {}
  })
  render(
    <CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: `stop-intent-${next}` }} />
  )
  const stop = await screen.findByRole('button', { name: 'Stop this round' })
  fireEvent.click(stop)
  await screen.findByText('Stop timed out')

  if (next === 'send') {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''))
  } else if (next === 'retry') {
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.retry')).toBe(true))
  }

  await waitFor(() => expect((stop as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(stop)
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)
  const ids = request.mock.calls.filter(call => call[1] === 'groups.stop').map(call => call[2].cancel_id)
  expect(ids).toHaveLength(2)
  expect(ids[1] === ids[0]).toBe(next === 'none')
})

it('keeps one cancellation intent until Stop is confirmed, and fences again behind a message still sending on plain HTTP', async () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  let deliver!: (value: unknown) => void
  let stops = 0
  request.mockImplementation(async (_route, method, params) => {
    if (method === 'groups.state') {
      return { room: { name: 'Room' }, driver_status: { working: true } }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.send') {
      return new Promise(resolve => {
        deliver = resolve
      })
    }

    if (method === 'groups.stop') {
      stops += 1

      if (stops === 1) {
        throw new Error('request timed out: groups.stop')
      }

      return { cancelled: stops === 2 ? 2 : 0 }
    }

    return params
  })
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'busy-send' }} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  const stop = screen.getByRole('button', { name: 'Stop this round' }) as HTMLButtonElement
  fireEvent.click(stop)
  await screen.findByText('request timed out: groups.stop')
  fireEvent.click(stop)
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Long task' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(true))
  expect(screen.queryByText(CANONICAL_GROUP_LOCALES.en.stopped)).toBeNull()
  expect(stop.disabled).toBe(false)
  fireEvent.click(stop)
  // The first fence leaves at once; the message on the wire may post after it, so Stop stays open.
  await waitFor(() => expect(stops).toBe(3))
  expect(stop.disabled).toBe(true)
  deliver(receipt(request.mock.calls.find(call => call[1] === 'groups.send')![2]))
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)

  const cancelIds = request.mock.calls.filter(call => call[1] === 'groups.stop').map(call => call[2].cancel_id)
  expect(cancelIds).toHaveLength(4)
  expect(cancelIds[1]).toBe(cancelIds[0])
  expect(new Set(cancelIds.slice(1)).size).toBe(3)
})

it('follows a retried Stop that replayed its lost fence with a fresh one when the room still works', async () => {
  let stops = 0
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room: { name: 'Room' }, driver_status: { working: true } }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.stop') {
      stops += 1

      // The first Stop committed but its reply was lost; work sent afterward is past its fence.
      if (stops === 1) {
        throw new Error('request timed out: groups.stop')
      }

      return { cancelled: stops === 2 ? 0 : 1 }
    }

    return {}
  })
  render(
    <CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'stop-replay-late-work' }} />
  )
  const stop = (await screen.findByRole('button', { name: 'Stop this round' })) as HTMLButtonElement
  fireEvent.click(stop)
  await screen.findByText('request timed out: groups.stop')
  await waitFor(() => expect(stop.disabled).toBe(false))
  fireEvent.click(stop)
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)
  const ids = request.mock.calls.filter(call => call[1] === 'groups.stop').map(call => call[2].cancel_id)
  expect(ids).toHaveLength(3)
  expect(ids[1]).toBe(ids[0])
  expect(ids[2]).not.toBe(ids[0])
})

it('holds the next Send until a Stop still fencing behind the last one has finished', async () => {
  let deliver!: (value: unknown) => void
  let releaseFirstStop!: () => void
  let stops = 0
  request.mockImplementation(async (_route, method, params) => {
    if (method === 'groups.state') {
      return { room: { name: 'Room' }, driver_status: { working: true } }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.send') {
      return params.payload.text === 'A'
        ? new Promise(resolve => {
            deliver = resolve
          })
        : receipt(params)
    }

    if (method === 'groups.stop') {
      stops += 1

      return stops === 1
        ? new Promise(resolve => {
            releaseFirstStop = () => resolve({ cancelled: 1 })
          })
        : { cancelled: 0 }
    }

    return params
  })
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'stop-then-send' }} />)
  const box = screen.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(box.disabled).toBe(false))
  fireEvent.change(box, { target: { value: 'A' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(request.mock.calls.some(call => call[1] === 'groups.send')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Stop this round' }))
  await waitFor(() => expect(stops).toBe(1))
  await act(async () => deliver(receipt(request.mock.calls.find(call => call[1] === 'groups.send')![2])))
  await waitFor(() => expect(box.value).toBe(''))
  fireEvent.change(box, { target: { value: 'B' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 50))
  })

  const order = () =>
    request.mock.calls
      .filter(call => call[1] === 'groups.send' || call[1] === 'groups.stop')
      .map(call => (call[1] === 'groups.send' ? `send:${call[2].payload.text}` : 'stop'))

  // While Stop still has to fence behind A, B does not leave: that fence would cancel it.
  expect(order()).toEqual(['send:A', 'stop'])
  await act(async () => releaseFirstStop())
  await screen.findByText(CANONICAL_GROUP_LOCALES.en.stopped)
  expect(order()).toEqual(['send:A', 'stop', 'stop'])
  expect(box.value).toBe('B')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(request.mock.calls.filter(call => call[1] === 'groups.send')).toHaveLength(2))
})

it('reopens a message the gateway proved unsent as an editable draft, not a restored unconfirmed Send, on plain HTTP', async () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  const binding = { connectionId: 'remote', profile: 'team', roomId: 'refused-reopen' }

  const refusedBefore = Object.assign(new Error('refused'), {
    code: 4001,
    data: { reason: 'refused', admitted: false }
  })

  request.mockImplementation(async (_route, method) =>
    method === 'groups.state'
      ? { room: { name: 'Room' }, driver_status: { working: true } }
      : method === 'groups.log'
        ? { events: [] }
        : method === 'groups.send'
          ? Promise.reject(refusedBefore)
          : {}
  )
  const view = render(<CanonicalGroupWorkspace binding={binding} />)
  let box = screen.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(box.disabled).toBe(false))
  fireEvent.change(box, { target: { value: 'Draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(box.disabled).toBe(false))
  await waitFor(async () => expect((await readCanonicalGroupSend(binding))?.attempts).toBe(0))
  view.unmount()

  render(<CanonicalGroupWorkspace binding={binding} />)
  box = screen.getByRole('textbox') as HTMLTextAreaElement
  await waitFor(() => expect(box.value).toBe('Draft'))
  await waitFor(() => expect(box.disabled).toBe(false))
  expect(screen.queryByText(/unconfirmed send was restored/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()

  request.mockImplementation(async (_route, method, params) =>
    method === 'groups.state'
      ? { room: { name: 'Room' }, driver_status: { working: true } }
      : method === 'groups.log'
        ? { events: [] }
        : receipt(params)
  )
  fireEvent.change(box, { target: { value: 'Edited draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(box.value).toBe(''))
  const sends = request.mock.calls.filter(call => call[1] === 'groups.send').map(call => call[2])
  expect(sends.map(params => params.payload.text)).toEqual(['Draft', 'Edited draft'])
  expect(sends[1].event_id).not.toBe(sends[0].event_id)
  expect(await readCanonicalGroupSend(binding)).toBeUndefined()
})
