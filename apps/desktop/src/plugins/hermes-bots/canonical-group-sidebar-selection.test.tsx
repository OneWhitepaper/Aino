import type * as HermesSdk from '@hermes/plugin-sdk'
import { host } from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom, type WritableAtom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $botChatFocused } from './bot-state'
import {
  $canonicalGroupBindings,
  CanonicalGroupList,
  publishCanonicalGroup,
  registerCanonicalGroup
} from './canonical-group-registry'
import { $botMeta } from './data'
import { $groupChatWorkspace } from './group-chat'
import { groupChatMainTabs, recordGroupMainTab, recordGroupOpenOrigin } from './group-panes'
import { translateBotsIn } from './i18n-test-helper'

const { requestProfile, paneVisibility } = vi.hoisted(() => ({ requestProfile: vi.fn(), paneVisibility: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { en } = await import('@/i18n/en')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      requestProfile,
      paneVisibility,
      state: {
        ...sdk.host.state,
        connectionId: sdk.atom<string | null>('local'),
        profile: sdk.atom('default'),
        gateway: sdk.atom('open')
      }
    },
    useI18n: () => ({ locale: 'en', t: en }),
    usePluginI18n: () => translateBotsIn('en')
  }
})

const route = { connectionId: 'local', profile: 'default' }

const room = {
  room_id: 'one',
  name: 'Design team',
  members: [{ member_id: 'a', profile: 'review', handle: 'reviewer' }]
}

const $visible = atom(true)

beforeEach(() => {
  ;(host.state.connectionId as WritableAtom<string | null>).set(route.connectionId)
  ;(host.state.profile as WritableAtom<string>).set(route.profile)
  ;(host.state.gateway as WritableAtom<string>).set('open')
  $canonicalGroupBindings.set({})
  $botMeta.set({})
  $groupChatWorkspace.set(null)
  $botChatFocused.set(false)
  groupChatMainTabs.clear()
  $visible.set(true)
  paneVisibility.mockReset().mockReturnValue($visible)
  requestProfile.mockReset().mockResolvedValue({ rooms: [room], next_offset: null })
})

afterEach(() => {
  cleanup()
  groupChatMainTabs.clear()
  $canonicalGroupBindings.set({})
  $botMeta.set({})
  $groupChatWorkspace.set(null)
  $botChatFocused.set(false)
})

it('highlights a name-opened room through its source-qualified alias', async () => {
  publishCanonicalGroup(route, room.name, { authority: route, room }, 'name')
  recordGroupOpenOrigin(room.name, 'name')
  $groupChatWorkspace.set(room.name)
  render(<CanonicalGroupList onOpen={vi.fn()} />)

  expect((await screen.findByRole('button', { name: room.name })).getAttribute('aria-current')).toBe('true')
})

it('uses the visible main group tab over stale bot focus and clears selection when that tab is hidden', async () => {
  const key = registerCanonicalGroup(route, room)
  recordGroupOpenOrigin(key, 'key')
  recordGroupMainTab(key, () => undefined)
  $groupChatWorkspace.set(key)
  $botChatFocused.set(true)
  render(<CanonicalGroupList onOpen={vi.fn()} />)

  const row = await screen.findByRole('button', { name: room.name })
  expect(row.getAttribute('aria-current')).toBe('true')
  expect(paneVisibility).toHaveBeenCalledWith(expect.stringContaining('plugin-workspace:hermes-bots:group:'))

  act(() => $visible.set(false))
  expect(row.getAttribute('aria-current')).toBeNull()
  act(() => $visible.set(true))
  expect(row.getAttribute('aria-current')).toBe('true')
})

it('does not select a local row for a same-room id selected on another authority', async () => {
  const key = registerCanonicalGroup({ connectionId: 'remote', profile: 'default' }, room)
  recordGroupOpenOrigin(key, 'key')
  $groupChatWorkspace.set(key)
  render(<CanonicalGroupList onOpen={vi.fn()} />)

  expect((await screen.findByRole('button', { name: room.name })).getAttribute('aria-current')).toBeNull()
})

it('filters group rows with the shared search term and opens the canonical identity', async () => {
  const onOpen = vi.fn()
  const view = render(<CanonicalGroupList onOpen={onOpen} query="reviewer" />)
  const row = await screen.findByRole('button', { name: room.name })
  fireEvent.click(row)
  expect(onOpen).toHaveBeenCalledWith('canonical:local:default:one', 'key')

  view.rerender(<CanonicalGroupList onOpen={onOpen} query="no match" />)
  expect(screen.queryByRole('button', { name: room.name })).toBeNull()
  view.rerender(<CanonicalGroupList onOpen={onOpen} query="" />)
  expect(screen.getByRole('button', { name: room.name })).toBeTruthy()
  expect(requestProfile.mock.calls.filter(call => call[1] === 'groups.list')).toHaveLength(1)
})

it('keeps group search aligned with a member rename and its captured connection without refetching rooms', async () => {
  const profile = 'u6d4b-u8bd5'
  const saved = { ...room, members: [{ member_id: 'seat-one', profile, handle: profile, display_name: profile }] }

  const roster = [
    { name: profile, connectionId: route.connectionId, display_name: '测试助手' },
    { name: profile, connectionId: 'studio', display_name: '另一连接助手' }
  ]

  requestProfile.mockResolvedValue({ rooms: [saved], next_offset: null })
  const view = render(<CanonicalGroupList onOpen={vi.fn()} query="测试助手" roster={roster} />)

  expect(await screen.findByRole('button', { name: room.name })).toBeTruthy()
  act(() => $botMeta.set({ [`${route.connectionId}::${profile}`]: { title: '新的测试助手' } }))
  view.rerender(<CanonicalGroupList onOpen={vi.fn()} query="新的测试助手" roster={roster} />)
  expect(screen.getByRole('button', { name: room.name })).toBeTruthy()
  view.rerender(<CanonicalGroupList onOpen={vi.fn()} query="另一连接助手" roster={roster} />)
  expect(screen.queryByRole('button', { name: room.name })).toBeNull()
  expect(requestProfile.mock.calls.filter(call => call[1] === 'groups.list')).toHaveLength(1)
})
