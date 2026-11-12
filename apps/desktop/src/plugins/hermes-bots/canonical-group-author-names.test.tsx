import { useStore } from '@nanostores/react'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { createGroupGateway, pluginSdkMock } = await import('./group-test-utils')
  const gateway = createGroupGateway()

  return {
    ...(await pluginSdkMock(gateway.host)),
    useValue: useStore,
    MessageTextContent: ({ text }: { text: string }) => <p>{text}</p>,
    Streamdown: ({ children }: { children: ReactNode }) => <p>{children}</p>
  }
})
vi.mock('./canonical-group-labels', async () => {
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')

  return { useCanonicalGroupLabels: () => ({ ...CANONICAL_GROUP_LOCALES.en, download: 'Download' }) }
})

import { CanonicalGroupHistory, canonicalGroupMessageMatches } from './canonical-group-history'
import type { CanonicalGroupEvent } from './canonical-group-history'
import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import { canonicalMemberName } from './canonical-group-members'
import type { CanonicalGroupBinding, CanonicalRoomMember } from './canonical-groups'
import { $botMeta, $lastRoster } from './data'

const profile = 'u6d4b-u8bd5'
const binding: CanonicalGroupBinding = { connectionId: 'local', profile: 'default', roomId: 'room-one' }
const member: CanonicalRoomMember = { member_id: profile, profile, handle: profile, display_name: profile }

beforeEach(() => {
  $lastRoster.set([{ name: profile, connectionId: 'local', display_name: '测试助手' }])
  $botMeta.set({})
})

afterEach(() => {
  cleanup()
  $lastRoster.set([])
  $botMeta.set({})
})

function message(
  actor: CanonicalGroupEvent['actor'] = { kind: 'member', id: profile, display_name: profile }
): CanonicalGroupEvent {
  return { seq: 1, kind: 'message.member', actor, payload: { text: 'The requested work is complete.' } }
}

function author(container: HTMLElement) {
  return container.querySelector('.aino-group-message-meta strong')?.textContent
}

it('shows the readable live name when the real log stamps the encoded profile as its display name', () => {
  const { container } = render(<CanonicalGroupHistory binding={binding} events={[message()]} members={[member]} />)

  expect(author(container)).toBe('测试助手')
  expect(container.querySelector('.aino-group-message-meta')?.textContent).not.toContain(profile)
})

it('uses the same live author for a transcript highlight and its search count', () => {
  const event = message()
  const nameFor = (seat: CanonicalRoomMember) =>
    canonicalMemberName(seat, binding, $lastRoster.get(), $botMeta.get(), 'local')
  const { container } = render(
    <CanonicalGroupHistory binding={binding} events={[event]} members={[member]} searchQuery="测试助手" />
  )

  expect(canonicalGroupMessageMatches(event, binding, new Map([[profile, member]]), '测试助手', nameFor)).toBe(true)
  expect(container.querySelector('article')?.getAttribute('data-search-match')).toBe('true')
})

it('resolves the live name even when an older member event has no actor display name', () => {
  const { container } = render(
    <CanonicalGroupHistory binding={binding} events={[message({ kind: 'member', id: profile })]} members={[member]} />
  )

  expect(author(container)).toBe('测试助手')
})

it('uses the current bot name for a seated member even when its log has a meaningful older Chinese name', () => {
  const { container } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[message({ kind: 'member', id: profile, display_name: '原研究助手' })]}
      members={[member]}
    />
  )

  expect(author(container)).toBe('测试助手')
  expect(screen.queryByText('原研究助手')).toBeNull()
})

it('reads an encoded speaker from its own connection rather than a same-profile bot on another connection', () => {
  $lastRoster.set([
    { name: profile, connectionId: 'local', display_name: '本机测试助手' },
    { name: profile, connectionId: 'studio', remoteSource: true, sourceScoped: true, display_name: '工作室测试助手' }
  ])
  const { container } = render(
    <CanonicalGroupHistory binding={{ ...binding, connectionId: 'studio' }} events={[message()]} members={[member]} />
  )

  expect(author(container)).toBe('工作室测试助手')
  expect(container.querySelector('.aino-group-message-meta')?.textContent).not.toContain('本机测试助手')
})

it('does not borrow another connection name after the original connection roster disappears', () => {
  $lastRoster.set([{ name: profile, connectionId: 'local', display_name: '另一连接的助手' }])
  const savedMember = { ...member, display_name: '工作室保存的助手' }
  const { container } = render(
    <CanonicalGroupHistory
      binding={{ ...binding, connectionId: 'studio' }}
      events={[message()]}
      members={[savedMember]}
    />
  )

  expect(author(container)).toBe('工作室保存的助手')
  expect(screen.queryByText('另一连接的助手')).toBeNull()
})

it('does not treat a human actor as a bot when their ids happen to match', () => {
  const event = { ...message({ kind: 'user', id: profile, display_name: '群聊参与者' }), kind: 'message.user' }
  const { container } = render(<CanonicalGroupHistory binding={binding} events={[event]} members={[member]} />)

  expect(author(container)).toBe('群聊参与者')
  expect(container.querySelector('article')?.getAttribute('data-own')).toBe('true')
  expect(screen.queryByText('测试助手')).toBeNull()
})

it('keeps a departed member historical name without attaching it to an unrelated live bot', () => {
  const { container } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[message({ kind: 'member', id: profile, display_name: '已离开的研究助手' })]}
      members={[]}
    />
  )

  expect(author(container)).toBe('已离开的研究助手')
  expect(screen.queryByText('测试助手')).toBeNull()
})

it('uses a generic member label for a departed speaker with only an encoded id left in its actor', () => {
  const { container } = render(<CanonicalGroupHistory binding={binding} events={[message()]} members={[]} />)

  expect(author(container)).toBe(CANONICAL_GROUP_LOCALES.en.memberGeneric)
  expect(container.querySelector('.aino-group-message-meta')?.textContent).not.toContain(profile)
  expect(screen.queryByText('测试助手')).toBeNull()
})

it('uses the readable live name for failed-work notices as well as the message header', () => {
  const event: CanonicalGroupEvent = {
    seq: 1,
    kind: 'turn.failed',
    payload: { member_id: profile, reason: 'Try again later.' }
  }
  const { container } = render(<CanonicalGroupHistory binding={binding} events={[event]} members={[member]} />)

  expect(container.querySelector('summary')?.textContent).toContain('测试助手')
  expect(container.querySelector('summary')?.textContent).not.toContain(profile)
  expect(container.querySelector('pre')?.textContent).toContain(profile)
})
