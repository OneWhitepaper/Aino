import type * as HermesSdk from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { en } = await import('@/i18n/en')

  return {
    ...sdk,
    useI18n: () => ({ locale: 'en', t: en }),
    host: { ...sdk.host, state: { ...sdk.host.state, connectionId: sdk.atom('local') } }
  }
})
vi.mock('./data', async () => {
  const { atom } = await import('nanostores')

  return { $lastRoster: atom([]), $botMeta: atom({}) }
})
vi.mock('./canonical-group-labels', async () => {
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')

  return {
    useCanonicalGroupLabels: () => ({
      ...CANONICAL_GROUP_LOCALES.en,
      close: 'Close',
      back: 'Back',
      rename: 'Rename',
      renameLabel: 'Name',
      save: 'Save',
      cancel: 'Cancel',
      disband: 'Disband',
      disbanding: 'Disbanding',
      disbandDone: 'Disbanded',
      disbandTitle: 'Disband group?',
      disbandDescPrefix: 'Disband ',
      disbandDescSuffix: (count: number) => ` with ${count} members?`
    })
  }
})

import { CanonicalGroupHeader, CanonicalGroupInfo } from './canonical-group-header'
import { resolveCanonicalMember } from './canonical-group-members'
import type { CanonicalRoom } from './canonical-groups'

const binding = { connectionId: 'local', profile: 'default', roomId: 'room-one' }

const room: CanonicalRoom = {
  room_id: 'room-one',
  name: 'Product team',
  members: [{ member_id: 'bot-one', profile: 'reviewer', handle: 'review-bot', display_name: 'Reviewer' }]
}

const common = {
  binding,
  room,
  busy: false,
  phases: new Map(),
  onRename: vi.fn(),
  onDisband: vi.fn(async () => undefined)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('keeps management actions in group info and exposes compact accessible header controls', () => {
  const onInfo = vi.fn()
  const onSearch = vi.fn()

  const { rerender } = render(
    <CanonicalGroupHeader
      {...common}
      canStop={false}
      infoOpen={false}
      onInfoOpenChange={onInfo}
      onSearch={onSearch}
      onStop={vi.fn()}
    />
  )

  expect(screen.getByRole('heading', { name: /Product team/ })).toBeTruthy()
  expect(screen.getByText(/Ready/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Disband' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
  const info = screen.getByRole('button', { name: 'Group info' })
  expect(info.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(info)
  expect(onInfo).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Search messages' }))
  expect(onSearch).toHaveBeenCalledOnce()

  rerender(<CanonicalGroupHeader {...common} canStop infoOpen onInfoOpenChange={onInfo} onStop={vi.fn()} />)
  expect(screen.getByText(/The group is working/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Group info' }).getAttribute('aria-expanded')).toBe('true')
})

it('mentions the routed member and renames without losing the original callbacks', () => {
  const onMention = vi.fn()
  const onRename = vi.fn()
  render(<CanonicalGroupInfo {...common} onClose={vi.fn()} onMention={onMention} onRename={onRename} />)

  fireEvent.click(screen.getByRole('button', { name: 'Mention Reviewer' }))
  expect(onMention).toHaveBeenCalledWith(room.members[0])
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  const dialog = screen.getByRole('dialog', { name: 'Rename' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: '  New name  ' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(onRename).toHaveBeenCalledWith('New name')
  expect(screen.queryByRole('dialog', { name: 'Rename' })).toBeNull()
})

it('does not label an unavailable service or its idle members as ready', () => {
  render(
    <>
      <CanonicalGroupHeader {...common} available={false} canStop={false} onStop={vi.fn()} />
      <CanonicalGroupInfo {...common} available={false} onClose={vi.fn()} />
    </>
  )
  expect(screen.getByText(/Group service unavailable/)).toBeTruthy()
  expect(screen.getByText('Member unavailable')).toBeTruthy()
  expect(screen.queryByText('Ready')).toBeNull()
})

it('keeps member tasks separate from files and technical management', () => {
  render(<CanonicalGroupInfo {...common} onClose={vi.fn()} onMention={vi.fn()} />)
  expect(screen.getByRole('list', { name: 'Members' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Disband' })).toBeNull()

  fireEvent.keyDown(screen.getByRole('tab', { name: 'Group files' }), { key: 'Enter' })
  expect(screen.getByText('No shared files yet.')).toBeTruthy()
  expect(screen.queryByRole('list', { name: 'Members' })).toBeNull()

  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  expect(screen.getAllByRole('button', { name: 'Rename' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Disband' })).toBeTruthy()
  const technical = screen.getByText('Technical details').closest('details')!
  expect(technical.open).toBe(false)
  fireEvent.click(screen.getByText('Technical details'))
  expect(technical.open).toBe(true)
  expect(within(technical).getByText('@review-bot')).toBeTruthy()
})

it('keeps a refused disband confirmation open with the gateway error', async () => {
  const onDisband = vi.fn(async () => {
    throw new Error('Owner changed')
  })

  render(<CanonicalGroupInfo {...common} onClose={vi.fn()} onDisband={onDisband} />)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: 'Disband' }))
  const dialog = screen.getByRole('dialog', { name: 'Disband group?' })
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disband' }))
  })
  expect(onDisband).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog', { name: 'Disband group?' })).toBeTruthy()
  expect(screen.getByText('Owner changed')).toBeTruthy()
})

it('suspends hidden-room dialogs and restores the rename draft when the room returns', () => {
  const { rerender } = render(<CanonicalGroupInfo {...common} onClose={vi.fn()} />)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Unsent rename' } })
  rerender(<CanonicalGroupInfo {...common} onClose={vi.fn()} visible={false} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  rerender(<CanonicalGroupInfo {...common} onClose={vi.fn()} visible />)
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Unsent rename')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Manage' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: 'Disband' }))
  rerender(<CanonicalGroupInfo {...common} onClose={vi.fn()} visible={false} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  rerender(<CanonicalGroupInfo {...common} onClose={vi.fn()} visible />)
  expect(screen.getByRole('dialog', { name: 'Disband group?' })).toBeTruthy()
})

it('does not borrow the active gateway title or avatar for a foreign same-name member', () => {
  const foreignBinding = { ...binding, connectionId: 'other' }
  const member = room.members[0]
  const otherRow = { name: 'reviewer', connectionId: 'other' }
  const foregroundMeta = { reviewer: { title: 'Wrong account', image: 'wrong.png' } }
  const foreign = resolveCanonicalMember(member, foreignBinding, [otherRow], foregroundMeta, 'local')
  expect(foreign.name).toBe('Reviewer')
  expect(foreign.appearance.image).toBeNull()
  const qualifiedMeta = { ...foregroundMeta, 'other::reviewer': { title: 'Other reviewer', image: 'right.png' } }
  const resolved = resolveCanonicalMember(member, foreignBinding, [otherRow], qualifiedMeta, 'local')
  expect(resolved.name).toBe('Other reviewer')
  expect(resolved.appearance.image).toBe('right.png')
})

it('uses current member presentation while preserving the frozen mention handle', () => {
  const member = room.members[0]

  const resolved = resolveCanonicalMember(
    member,
    binding,
    [{ name: 'reviewer', connectionId: 'local' }],
    { reviewer: { title: 'Renamed reviewer', custom: true, shape: 'circle', image: 'custom.png' } },
    'local'
  )

  expect(resolved.name).toBe('Renamed reviewer')
  expect(resolved.appearance.image).toBe('custom.png')
  expect(member.handle).toBe('review-bot')
})
