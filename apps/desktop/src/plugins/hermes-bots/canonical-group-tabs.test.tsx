import type * as HermesSdk from '@hermes/plugin-sdk'
import { host } from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WritableAtom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import {
  $canonicalGroupBindings,
  publishCanonicalGroup,
  registerCanonicalGroup,
  syncCanonicalGroupName
} from './canonical-group-registry'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
import { $botMeta } from './data'
import { $groupChats, $groupChatWorkspace } from './group-chat'
import type * as GroupChatParts from './group-chat-parts'
import { GroupChatWorkspace, openGroupChat } from './group-chat-view'
import { groupChatMainTabs } from './group-panes'
import { translateBots } from './i18n-test-helper'

const { request, openWorkspace } = vi.hoisted(() => ({ request: vi.fn(), openWorkspace: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { en } = await import('@/i18n/en')

  return {
    ...sdk,
    gatewayActivationEpoch: () => 1,
    useGatewayActivationEpoch: () => 1,
    host: {
      ...sdk.host,
      notify: vi.fn(),
      requestProfile: request,
      request: (method: string, params?: Record<string, unknown>) => request(null, method, params),
      openWorkspace,
      paneVisibility: () => sdk.atom(true),
      setWorkspaceScope: vi.fn(),
      setWorkspaceOwnerLabel: vi.fn(),
      connections: vi.fn(async () => []),
      state: {
        ...sdk.host.state,
        connectionId: sdk.atom<string | null>('local'),
        profile: sdk.atom('default'),
        gateway: sdk.atom('open')
      }
    },
    useI18n: () => ({ locale: 'en', t: en }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./group-chat-parts', async importOriginal => ({
  ...(await importOriginal<typeof GroupChatParts>()),
  GroupImageControls: () => null
}))

const state = {
  connectionId: host.state.connectionId as WritableAtom<string | null>,
  profile: host.state.profile as WritableAtom<string>,
  gateway: host.state.gateway as WritableAtom<string>
}

const route = { connectionId: 'local', profile: 'default' }

const room = {
  room_id: 'room-original',
  name: 'Design team',
  members: [{ member_id: 'helper', profile: 'helper', handle: 'helper' }]
}

beforeEach(() => {
  state.connectionId.set(route.connectionId)
  state.profile.set(route.profile)
  state.gateway.set('open')
  $canonicalGroupBindings.set({})
  $groupChats.set({})
  $groupChatWorkspace.set(null)
  $botMeta.set({})
  groupChatMainTabs.clear()
  request.mockReset().mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room, driver_status: {} }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    throw new Error(`Unexpected RPC: ${method}`)
  })
  openWorkspace.mockReset().mockImplementation((_id, options) => () => options.onClose?.())
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()

  for (const close of [...groupChatMainTabs.values()]) {
    close()
  }

  groupChatMainTabs.clear()
  $canonicalGroupBindings.set({})
  localStorage.clear()
  vi.restoreAllMocks()
})

it('opens a group as a conversation tab whose label follows its original room after foreground navigation', () => {
  publishCanonicalGroup(route, room.name, { authority: route, room }, 'name')
  openGroupChat(room.name, 'name')
  expect(openWorkspace).toHaveBeenCalledOnce()
  const [workspaceId, options] = openWorkspace.mock.calls[0] as Parameters<typeof host.openWorkspace>
  expect(options.tabPresentation).toBe('conversation')
  expect(options.tabLead).toBeTypeOf('function')
  expect(options.title).toBe(room.name)
  render(<>{options.tabTitle?.()}</>)
  expect(screen.getByText(room.name)).toBeTruthy()

  act(() => {
    state.connectionId.set('remote')
    state.profile.set('another')
    const otherRoute = { connectionId: 'remote', profile: 'another' }
    publishCanonicalGroup(
      otherRoute,
      room.name,
      {
        authority: otherRoute,
        room: { ...room, room_id: 'other-room', name: 'Wrong foreground title' }
      },
      'name'
    )
    syncCanonicalGroupName({ ...route, roomId: room.room_id }, 'Renamed design team')
  })

  expect(screen.getByText('Renamed design team')).toBeTruthy()
  expect(screen.queryByText('Wrong foreground title')).toBeNull()
  expect(options.tabTitleText?.()).toBe('Renamed design team')
  expect(openWorkspace.mock.calls[0][0]).toBe(workspaceId)
  expect(openWorkspace).toHaveBeenCalledOnce()
})

it('opens resolved same-name rooms as separate immutable tabs with matching titles and bodies', async () => {
  const remote = { connectionId: 'remote', profile: 'work' }
  publishCanonicalGroup(route, 'Team', { authority: route, room: { ...room, name: 'Team' } }, 'name')
  openGroupChat('Team', 'name')
  const [localId, local] = openWorkspace.mock.calls[0] as Parameters<typeof host.openWorkspace>

  state.connectionId.set(remote.connectionId)
  state.profile.set(remote.profile)
  const otherRoom = { ...room, room_id: 'room-other', name: 'Team' }
  publishCanonicalGroup(remote, 'Team', { authority: remote, room: otherRoom }, 'name')
  openGroupChat('Team', 'name')
  const [remoteId, other] = openWorkspace.mock.calls[1] as Parameters<typeof host.openWorkspace>
  expect(localId).not.toBe(remoteId)
  expect(local.workspaceScope).not.toEqual(other.workspaceScope)

  request.mockImplementation(async (owner, method, params) => {
    if (method === 'groups.state') {
      return { room: owner.connectionId === 'local' ? room : otherRoom, driver_status: {} }
    }

    if (method === 'groups.log') {
      return {
        events: [
          {
            seq: 1,
            room_id: params.room_id,
            kind: 'message.member',
            actor: { kind: 'member', id: 'helper' },
            payload: { text: `${owner.connectionId} reply` }
          }
        ]
      }
    }

    throw new Error(`Unexpected RPC: ${method}`)
  })
  const LocalWorkspace = local.render

  const view = render(
    <>
      {local.tabTitle?.()}
      <LocalWorkspace />
    </>
  )

  await screen.findByText('local reply')
  expect(screen.queryByText('remote reply')).toBeNull()
  expect(request.mock.calls.filter(call => call[1] === 'groups.state').map(call => call[0].connectionId)).toEqual([
    'local'
  ])
  view.unmount()
  const RemoteWorkspace = other.render
  render(
    <>
      {other.tabTitle?.()}
      <RemoteWorkspace />
    </>
  )
  await screen.findByText('remote reply')
})

it('freezes an unresolved name lookup to its opener and an old close cannot clear the new source selection', async () => {
  request.mockImplementation(async (owner, method, params) => {
    const ownedRoom = { ...room, room_id: `${owner.connectionId}-room`, name: 'Team' }

    if (method === 'groups.capabilities') {
      return { driver: true }
    }

    if (method === 'groups.list') {
      return { rooms: [ownedRoom], next_offset: null }
    }

    if (method === 'groups.state') {
      return { room: ownedRoom, driver_status: {} }
    }

    if (method === 'groups.log') {
      return {
        events: [
          {
            seq: 1,
            room_id: params.room_id,
            kind: 'message.member',
            actor: { kind: 'member', id: 'helper' },
            payload: { text: `${owner.connectionId} reply` }
          }
        ]
      }
    }

    throw new Error(`Unexpected RPC: ${method}`)
  })
  openGroupChat('Team', 'name')
  const [localId, local] = openWorkspace.mock.calls[0] as Parameters<typeof host.openWorkspace>
  state.connectionId.set('remote')
  openGroupChat('Team', 'name')
  const [remoteId, other] = openWorkspace.mock.calls[1] as Parameters<typeof host.openWorkspace>
  expect(localId).not.toBe(remoteId)
  expect(local.workspaceScope).not.toEqual(other.workspaceScope)
  local.onClose?.()
  expect($groupChatWorkspace.get()).toBe('Team')
  expect(groupChatMainTabs.has('Team')).toBe(true)

  const LocalWorkspace = local.render
  render(
    <>
      {local.tabTitle?.()}
      <LocalWorkspace />
    </>
  )
  await screen.findByText('local reply')
  expect(screen.queryByText('remote reply')).toBeNull()
  // The gate and paginated room discovery each negotiate capabilities. Every
  // read must retain the opener's authority, regardless of their read count.
  const reads = request.mock.calls.filter(call => call[1].startsWith('groups.'))
  expect(reads.some(call => call[1] === 'groups.capabilities')).toBe(true)
  expect(reads.some(call => call[1] === 'groups.state' && call[2].room_id === 'local-room')).toBe(true)

  for (const [owner] of reads) {
    expect(owner).toMatchObject({ ...route, targetProfile: route.profile })
  }

  expect(request.mock.calls.some(call => call[1] === 'groups.create')).toBe(false)
})

it('keeps long immutable room ids distinct instead of truncating their shared prefix', () => {
  for (const suffix of ['a', 'b']) {
    const key = registerCanonicalGroup(route, { ...room, room_id: `${'same-prefix-'.repeat(9)}${suffix}` })
    openGroupChat(key, 'key')
  }

  expect(openWorkspace.mock.calls[0][0]).not.toBe(openWorkspace.mock.calls[1][0])
  expect(openWorkspace.mock.calls[0][1].workspaceScope).not.toEqual(openWorkspace.mock.calls[1][1].workspaceScope)
})

it('keeps the embedded toolbar compact while retaining the title and Back in the sidebar fallback', async () => {
  const key = registerCanonicalGroup(route, room)
  const onBack = vi.fn()

  const view = await act(async () =>
    render(<GroupChatWorkspace group={key} mainTab members={[]} onBack={onBack} origin="key" />)
  )

  expect(screen.queryByRole('heading', { name: room.name })).toBeNull()
  expect(screen.getByRole('region', { name: room.name })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  const roomReads = request.mock.calls.filter(call => call[1] === 'groups.state')
  expect(roomReads).toHaveLength(1)
  expect(roomReads[0][0]).toMatchObject(route)
  expect(roomReads[0][2]).toMatchObject({ room_id: room.room_id })

  view.rerender(<GroupChatWorkspace group={key} members={[]} onBack={onBack} origin="key" />)
  expect(screen.getByRole('heading', { name: room.name, level: 2 })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(onBack).toHaveBeenCalledOnce()
})

it('opens the production workspace under one host title while preserving group toolbar controls', async () => {
  const key = registerCanonicalGroup(route, room)
  openGroupChat(key, 'key')
  const [, options] = openWorkspace.mock.calls[0] as Parameters<typeof host.openWorkspace>
  const Workspace = options.render
  render(
    <>
      <h1>{options.title}</h1>
      <Workspace />
    </>
  )
  const region = await screen.findByRole('region', { name: room.name })

  expect(screen.getAllByRole('heading', { name: room.name })).toHaveLength(1)
  expect(screen.getByRole('heading', { name: room.name, level: 1 })).toBeTruthy()
  expect(within(region).queryByRole('heading', { name: room.name })).toBeNull()
  expect(within(region).getByText(/1 Members/)).toBeTruthy()
  expect(within(region).getByRole('button', { name: 'Search messages' })).toBeTruthy()
  expect(within(region).getByRole('button', { name: 'Group info' })).toBeTruthy()
})

it('keeps a standalone canonical workspace fully named without requiring host chrome', async () => {
  const onBack = vi.fn()
  render(<CanonicalGroupWorkspace binding={{ ...route, roomId: room.room_id }} onBack={onBack} />)
  expect(await screen.findByRole('heading', { name: room.name, level: 2 })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(onBack).toHaveBeenCalledOnce()
})

it('allows leaving the fallback without a supplied callback by clearing the selected group', async () => {
  const key = registerCanonicalGroup(route, room)
  $groupChatWorkspace.set(key)
  await act(async () => render(<GroupChatWorkspace group={key} members={[]} origin="key" />))

  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect($groupChatWorkspace.get()).toBeNull()
})

it('closes a main group tab after a confirmed disband without showing a redundant Back control', async () => {
  let refuse = true
  request.mockImplementation(async (_route, method) => {
    if (method === 'groups.state') {
      return { room, driver_status: {} }
    }

    if (method === 'groups.log') {
      return { events: [] }
    }

    if (method === 'groups.disband') {
      if (refuse) {
        throw new Error('Room is busy')
      }

      return { tombstone: { room_id: room.room_id, disbanded_at: 1 } }
    }

    return {}
  })
  const key = registerCanonicalGroup(route, room)
  const onClose = vi.fn()
  await act(async () => render(<GroupChatWorkspace group={key} mainTab members={[]} onBack={onClose} origin="key" />))
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Group info' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: 'Disband' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disband' }))
  await within(dialog).findByText(
    CANONICAL_GROUP_LOCALES.en.disbandKept.replace('{reason}', CANONICAL_GROUP_LOCALES.en.disbandUnconfirmed)
  )
  expect(onClose).not.toHaveBeenCalled()

  refuse = false
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disband' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect($canonicalGroupBindings.get()[key]).toBeUndefined()
})
