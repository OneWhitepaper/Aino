import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import type { Components } from 'streamdown'
import { afterEach, expect, it, vi } from 'vitest'

const clipboardWrite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/clipboard', () => ({ writeClipboardText: clipboardWrite }))
vi.mock('@/i18n', async () => {
  const { en } = await import('@/i18n/en')

  return { useI18n: () => ({ locale: 'en', t: en }) }
})
vi.mock('@hermes/plugin-sdk', async () => {
  const { Streamdown } = await import('streamdown')
  const { en } = await import('@/i18n/en')
  const { relativeTime } = await import('@/lib/time')
  const { CopyButton } = await import('@/components/ui/copy-button')

  // The shell's shared message renderer; media marks whether MEDIA: paths would resolve locally.
  const MessageTextContent = ({
    decorateText,
    media = true,
    previewOnly = false,
    text
  }: {
    decorateText?: (children: ReactNode) => ReactNode
    media?: boolean
    previewOnly?: boolean
    text: string
  }) => {
    // Streamdown's component map accepts intrinsic props AND an open custom-tag
    // record. The fixture consumes only children, so it accepts both shapes.
    const decorate = (props: object) => {
      const children = 'children' in props ? (props.children as ReactNode) : undefined

      return decorateText ? decorateText(children) : children
    }

    const components: Components = {
      p: (props: object) => <p>{decorate(props)}</p>,
      li: (props: object) => <li>{decorate(props)}</li>,
      td: (props: object) => <td>{decorate(props)}</td>
    }

    return (
      <div data-media={String(media)} data-preview-only={String(previewOnly)} data-testid="message-text">
        <Streamdown components={components}>{text}</Streamdown>
      </div>
    )
  }

  return {
    ...(await (await import('./group-test-utils')).pluginSdkMock({})),
    CopyButton,
    MessageTextContent,
    Streamdown,
    relativeTime,
    useI18n: () => ({ locale: 'en', t: en }),
    Button: (props: ComponentProps<'button'>) => <button {...props} />,
    Codicon: () => <span />,
    Tip: ({ children }: { children: ReactNode }) => <>{children}</>
  }
})
vi.mock('./canonical-group-members', () => ({
  canonicalMemberName: (member: { display_name?: string; handle: string }) => member.display_name || member.handle,
  useCanonicalMembers: () => ({
    nameFor: (member: { display_name?: string; handle: string }) => member.display_name || member.handle
  }),
  CanonicalMemberAvatar: ({ member }: { member: { member_id: string } }) => (
    <span data-member-avatar={member.member_id} />
  )
}))
vi.mock('./canonical-group-labels', async () => {
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')

  return { useCanonicalGroupLabels: () => ({ ...CANONICAL_GROUP_LOCALES.en, download: 'Download' }) }
})

import { CanonicalGroupHistory } from './canonical-group-history'
import type { CanonicalGroupEvent } from './canonical-group-history'
import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'

const binding = { connectionId: 'local', profile: 'reviewer', roomId: 'room-one' }

afterEach(() => {
  cleanup()
  clipboardWrite.mockClear()
})

// groups.log returns actor.kind/id and Unix-second created_at, including on replay.
it('renders the canonical log actors, timestamps and Markdown without transport markers', () => {
  const events = [
    {
      seq: 1,
      kind: 'message.user',
      actor: { kind: 'user', id: 'uid:42', display_name: 'Morgan' },
      created_at: 1792152000,
      payload: { text: 'Please **review** this.' }
    },
    {
      seq: 2,
      kind: 'message.member',
      actor: { kind: 'member', id: 'helper', display_name: 'Historical Helper' },
      created_at: 1792152001,
      payload: { text: '**Done**' }
    },
    {
      seq: 3,
      kind: 'message.member',
      actor: { kind: 'member', id: 'reviewer' },
      created_at: 1792152002,
      payload: { text: 'Checked.' }
    },
    {
      seq: 4,
      kind: 'message.member',
      actor: { kind: 'member', id: 'departed-bot' },
      created_at: 1792152003,
      payload: { text: 'Earlier reply.' }
    },
    { seq: 5, kind: 'turn.settled', actor: { kind: 'gateway', id: 'owner' }, created_at: 1792152004, payload: {} }
  ]

  const members = [
    { member_id: 'helper', profile: 'helper', handle: 'helper', display_name: 'Renamed Helper' },
    { member_id: 'reviewer', profile: 'reviewer', handle: 'review', display_name: 'Code Reviewer' }
  ]

  const { container } = render(<CanonicalGroupHistory binding={binding} events={events} members={members} />)

  expect(screen.getByText('Morgan')).toBeTruthy()
  expect(screen.getByText('Renamed Helper')).toBeTruthy()
  expect(screen.getByText('Code Reviewer')).toBeTruthy()
  expect(screen.getByTitle('departed-bot').textContent).toBe(CANONICAL_GROUP_LOCALES.en.memberGeneric)
  expect(screen.queryByText('Historical Helper')).toBeNull()
  expect(screen.getByText('Morgan').closest('article')?.dataset.own).toBe('true')
  expect(screen.getByText('Renamed Helper').closest('article')?.dataset.own).toBe('false')
  expect(screen.getByText('Done').getAttribute('data-streamdown')).toBe('strong')
  expect(screen.getByText('review').getAttribute('data-streamdown')).toBe('strong')
  expect(screen.queryByText('turn.settled')).toBeNull()
  // Room text goes through the shared renderer, never resolving MEDIA: paths on this gateway.
  expect(screen.getAllByTestId('message-text').map(node => node.dataset.media)).toEqual([
    'false',
    'false',
    'false',
    'false'
  ])
  // Its images, file links and directive cards stay inert too.
  expect(screen.getAllByTestId('message-text').map(node => node.dataset.previewOnly)).toEqual([
    'true',
    'true',
    'true',
    'true'
  ])
  expect([...container.querySelectorAll('time')].map(node => node.dateTime)).toEqual(
    events.slice(0, 4).map(event => new Date(event.created_at * 1000).toISOString())
  )
  expect([...container.querySelectorAll('time')].every(node => node.textContent)).toBe(true)
})

it('keeps attachment-only messages and rows without optional display metadata readable', () => {
  const events = [
    {
      seq: 1,
      room_id: binding.roomId,
      event_id: 'file-event',
      kind: 'message.member',
      actor: { kind: 'member', id: 'bare-bot' },
      created_at: 0,
      payload: {
        attachments: [
          { attachment_id: 'att_00000000000000000000000000000001', kind: 'file', name: 'notes.txt', mime: 'text/plain' }
        ]
      }
    },
    { seq: 2, kind: 'message.user', actor: { kind: 'user', id: 'desktop' }, payload: { text: 'Older message' } },
    {
      seq: 3,
      kind: 'message.member',
      actor: { kind: 'member', id: 'helper' },
      created_at: Number.NaN,
      payload: { text: 'Missing clock' }
    },
    { seq: 4, kind: 'message.user', actor: { kind: 'user', id: 'helper' }, payload: { text: 'Different principal' } }
  ]

  const members = [{ member_id: 'helper', profile: 'helper', handle: 'bot-handle' }]
  const { container } = render(<CanonicalGroupHistory binding={binding} events={events} members={members} />)

  expect(screen.getByTitle('bare-bot').textContent).toBe(CANONICAL_GROUP_LOCALES.en.memberGeneric)
  expect(screen.getByText('notes.txt')).toBeTruthy()
  expect(screen.getByText('Older message')).toBeTruthy()
  expect(screen.getByText('Missing clock')).toBeTruthy()
  expect(screen.getByText('bot-handle')).toBeTruthy()
  expect(screen.getByText('helper')).toBeTruthy()
  expect(container.querySelector('time')?.dateTime).toBe(new Date(0).toISOString())
  expect(container.querySelectorAll('time')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Download notes.txt' })).toBeTruthy()
})

it('keeps failed, cancelled, deferred and unavailable work visible without printing transport markers', () => {
  const events = [
    { seq: 1, kind: 'turn.failed', payload: { member_id: 'helper', error: 'Provider timed out' } },
    { seq: 2, kind: 'turn.cancelled', payload: { member_id: 'helper', reason: 'Stopped by the operator' } },
    { seq: 3, kind: 'turn.deferred', payload: { member_id: 'helper', reason: 'Waiting for the owner' } },
    { seq: 4, kind: 'member.unavailable', payload: { member_id: 'helper', reason: 'Connection unavailable' } },
    { seq: 5, kind: 'turn.settled', payload: {} },
    { seq: 6, kind: 'turn.started', payload: {} },
    { seq: 7, kind: 'constructor', payload: {} },
    { seq: 8, kind: 'room.stop_requested', payload: {} },
    { seq: 9, kind: 'room.disbanded', payload: {} },
    { seq: 10, kind: 'authority.lost', payload: {} },
    { seq: 11, kind: 'room.activity', payload: { status: 'bounded', reason_code: 'max_rounds' } },
    { seq: 12, kind: 'room.activity', payload: { status: 'settled', reason_code: 'settled' } }
  ]

  const members = [{ member_id: 'helper', profile: 'helper', handle: 'helper', display_name: 'Code Helper' }]
  const { container } = render(<CanonicalGroupHistory binding={binding} events={events} members={members} />)

  for (const label of [
    'Turn failed',
    'Turn cancelled',
    'Turn deferred',
    'Member unavailable',
    'Group stopped',
    'Group disbanded',
    'Group ownership changed',
    'Group work limit reached'
  ]) {
    expect(screen.getByText(label)).toBeTruthy()
  }

  for (const detail of [
    'Provider timed out',
    'Stopped by the operator',
    'Waiting for the owner',
    'Connection unavailable'
  ]) {
    expect(container.textContent).toContain(detail)
  }

  expect(screen.getAllByText('Code Helper')).toHaveLength(4)
  expect(screen.getByText('Group stopped').parentElement?.textContent).toBe('Group stopped')
  expect(container.textContent).not.toMatch(/turn\.(settled|started)|constructor/)
})

it('announces a finished discussion only from its gateway room marker, preserving failed member notices', () => {
  const events = [
    { seq: 1, kind: 'turn.failed', payload: { member_id: 'helper', error: 'Provider timed out' } },
    { seq: 2, kind: 'turn.settled', payload: { member_id: 'reviewer', passed: true } }
  ]

  const { rerender } = render(<CanonicalGroupHistory binding={binding} events={events} />)
  expect(screen.queryByText('Replies for this message have ended')).toBeNull()
  rerender(
    <CanonicalGroupHistory
      binding={binding}
      events={[...events, { seq: 3, room_id: binding.roomId, kind: 'room.activity', payload: { status: 'settled' } }]}
    />
  )
  expect(screen.getByText('Replies for this message have ended')).toBeTruthy()
  expect(screen.getByText('Turn failed')).toBeTruthy()
  expect(screen.getByText(/Provider timed out/)).toBeTruthy()
})

it.each([null, false, '', '1792152000', Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
  'omits an invalid event timestamp (%s) without losing its message',
  createdAt => {
    const event = {
      seq: 1,
      kind: 'message.user',
      created_at: createdAt,
      payload: { text: 'Still readable' }
    } as unknown as CanonicalGroupEvent
    const { container } = render(<CanonicalGroupHistory binding={binding} events={[event]} />)

    expect(screen.getByText('Still readable')).toBeTruthy()
    expect(container.querySelector('time')).toBeNull()
  }
)

it('copies the original Markdown and addresses only a roster member when replying', async () => {
  const member = { member_id: 'helper', profile: 'helper', handle: 'code-helper', display_name: 'Helper' }
  const mention = vi.fn()
  const text = 'Use **exact source**\n\n`command --flag`'
  render(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        { seq: 1, kind: 'message.member', actor: { kind: 'member', id: member.member_id }, payload: { text } },
        {
          seq: 2,
          kind: 'message.user',
          actor: { kind: 'user', id: member.member_id },
          payload: { text: 'Different principal' }
        }
      ]}
      members={[member]}
      onMention={mention}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: `${CANONICAL_GROUP_LOCALES.en.reply} Helper` }))
  expect(mention).toHaveBeenCalledWith(member)
  expect(screen.getAllByRole('button', { name: new RegExp(CANONICAL_GROUP_LOCALES.en.reply) })).toHaveLength(1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
  await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(text))
  expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
})

it('explains a runtime transition and keeps every raw failure detail behind disclosure without inventing a retry', () => {
  const { container } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        {
          seq: 1,
          kind: 'turn.failed',
          payload: {
            member_id: 'helper',
            error: 'runtime_draining',
            reason: 'restart scheduled',
            reason_code: 'runtime_draining'
          }
        }
      ]}
      members={[{ member_id: 'helper', profile: 'helper', handle: 'helper', display_name: 'Helper' }]}
    />
  )

  expect(screen.getByText(CANONICAL_GROUP_LOCALES.en.serviceUnavailable)).toBeTruthy()
  expect(screen.getByText(CANONICAL_GROUP_LOCALES.en.serviceUnavailableHint)).toBeTruthy()
  const details = container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(details.textContent).toContain('runtime_draining\nrestart scheduled')
  expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
})

it('finds message text, historical author names and attachments without dropping the surrounding conversation', () => {
  const { container, rerender } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        {
          seq: 1,
          kind: 'message.user',
          actor: { kind: 'user', id: 'user', display_name: 'Morgan' },
          payload: { text: 'Keep the context' }
        },
        {
          seq: 2,
          kind: 'message.member',
          actor: { kind: 'member', id: 'helper' },
          payload: { attachments: [{ kind: 'file', name: 'Release notes.md', mime: 'text/markdown' }] }
        }
      ]}
      searchQuery="release"
    />
  )

  expect(container.querySelectorAll('article')).toHaveLength(2)
  expect(container.querySelector('[data-search-match="true"]')?.textContent).toContain('Release notes.md')
  expect(container.querySelector('[data-search-dim="true"]')?.textContent).toContain('Keep the context')
  rerender(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        {
          seq: 1,
          kind: 'message.user',
          actor: { kind: 'user', id: 'user', display_name: 'Morgan' },
          payload: { text: 'Keep the context' }
        }
      ]}
      searchQuery="MORGAN"
    />
  )
  expect(container.querySelector('[data-search-match="true"]')?.textContent).toContain('Keep the context')
})

it('renders frozen mentions as readable names while preserving code, links, unknown addresses and copied source', async () => {
  const member = { member_id: 'helper', profile: 'helper', handle: 'u6d4b-u8bd5', display_name: '测试助手' }
  const text =
    '@u6d4b-u8bd5 请检查 @everyone\n\n`@u6d4b-u8bd5`\n\n```text\n@u6d4b-u8bd5\n```\n\n[原链接 @u6d4b-u8bd5](https://example.com/@u6d4b-u8bd5)\n\n@u6d4b-u8bd5-extra ops@u6d4b-u8bd5.test'

  const { container } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        {
          seq: 1,
          kind: 'message.user',
          actor: { kind: 'user', id: 'viewer', display_name: 'Morgan' },
          payload: { text }
        }
      ]}
      members={[member]}
      searchQuery="测试助手"
    />
  )

  expect([...container.querySelectorAll('.aino-group-mention')].map(node => node.textContent)).toEqual([
    '@测试助手',
    `@${CANONICAL_GROUP_LOCALES.en.allMembers}`
  ])
  expect(container.querySelector('article')?.dataset.searchMatch).toBe('true')
  expect([...container.querySelectorAll('code')].map(node => node.textContent?.trim())).toEqual([
    '@u6d4b-u8bd5',
    '@u6d4b-u8bd5'
  ])
  expect(screen.getByRole('button', { name: '原链接 @u6d4b-u8bd5' })).toBeTruthy()
  expect(container.textContent).toContain('@u6d4b-u8bd5-extra ops@u6d4b-u8bd5.test')
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(text))
})

it('does not project addresses in code or links into a readable-name search result', () => {
  const member = { member_id: 'helper', profile: 'helper', handle: 'u6d4b-u8bd5', display_name: '测试助手' }

  const { container } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        {
          seq: 1,
          kind: 'message.user',
          actor: { kind: 'user', id: 'viewer', display_name: 'Morgan' },
          payload: { text: '`@u6d4b-u8bd5`\n\n~~~text\n@u6d4b-u8bd5\n~~~\n\n[引用 @u6d4b-u8bd5](https://example.com)' }
        }
      ]}
      members={[member]}
      searchQuery="测试助手"
    />
  )

  expect(container.querySelector('article')?.dataset.searchMatch).toBe('false')
})

it('keeps each failed discussion inspectable in a collapsed status row without marking it successful', () => {
  const { container } = render(
    <CanonicalGroupHistory
      binding={binding}
      events={[
        {
          seq: 1,
          kind: 'turn.failed',
          payload: { member_id: 'missing-one', thread_id: 'first', error: 'runtime_draining', discussion_event_id: 'a' }
        },
        {
          seq: 2,
          kind: 'turn.failed',
          payload: { member_id: 'missing-two', thread_id: 'second', error: 'provider_failed', discussion_event_id: 'b' }
        },
        {
          seq: 3,
          room_id: binding.roomId,
          kind: 'room.activity',
          payload: { status: 'settled', discussion_event_id: 'b' }
        }
      ]}
    />
  )

  const notices = [...container.querySelectorAll<HTMLDetailsElement>('details.aino-group-notice')]
  expect(notices).toHaveLength(2)
  expect(notices.every(notice => !notice.open)).toBe(true)
  expect(notices[0].querySelector('summary')?.textContent).not.toContain('missing-one')
  expect(notices[0].querySelector('pre')?.textContent).toContain('missing-one')
  expect(notices[1].querySelector('pre')?.textContent).toContain('provider_failed')
  fireEvent.click(notices[0].querySelector('summary')!)
  expect(notices[0].open).toBe(true)
  expect(notices[1].open).toBe(false)
  expect(screen.getByText(CANONICAL_GROUP_LOCALES.en.roundEnded)).toBeTruthy()
  expect(screen.queryByText(/success|succeeded/i)).toBeNull()
})
