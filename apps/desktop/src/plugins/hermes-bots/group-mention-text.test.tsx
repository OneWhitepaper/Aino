/**
 * #91359 — recognized group @mentions render as semantic inline references;
 * everything else stays prose. The classifier is the round loop's own parser,
 * so a token is styled exactly when routing would honour it.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { classifyGroupMention, renderGroupMentionText } from './group-mention-text'
import { addressedGroupMentionText, readableGroupMentionSearch } from './group-message-mentions'
import type { GroupMember } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    host: {
      request: vi.fn(),
      state: { connectionId: { get: () => 'local' }, profile: { get: () => 'default' } }
    },
    queryClient: { invalidateQueries: vi.fn() },
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

const members = [
  { name: 'planner', handle: 'planner' },
  { name: 'reviewer-mac-mini', handle: 'reviewer-mac-mini' }
] as GroupMember[]

describe('group mention rendering', () => {
  it('classifies seated bots, the human and broadcasts, and leaves unknown tokens plain', () => {
    expect(classifyGroupMention('planner', members)).toBe('agent')
    expect(classifyGroupMention('reviewer-mac-mini', members)).toBe('agent')
    expect(classifyGroupMention('user', members)).toBe('human')
    expect(classifyGroupMention('everyone', members)).toBe('broadcast')
    expect(classifyGroupMention('all', members)).toBe('broadcast')
    expect(classifyGroupMention('stranger', members)).toBeNull()
  })

  it('names recognized mentions and leaves source addresses outside the rendered prose', () => {
    const text = '@planner compare the options, then @user picks; mail ops@example.com — @everyone review'
    const html = renderToStaticMarkup(<>{renderGroupMentionText(text, members)}</>)

    expect(html).toContain('data-ref="agent"')
    expect(html).toContain('data-ref="human"')
    expect(html).toContain('data-ref="broadcast"')
    // `@example.com` is not a room identity — no span around it.
    expect(html).not.toMatch(/data-ref="[^"]*"[^>]*>@example/)
    expect(html.replace(/<[^>]+>/g, '')).toBe(
      '@Planner compare the options, then @You picks; mail ops@example.com — @Everyone review'
    )
  })

  it('uses a member display title without ever treating a matching email suffix as a mention', () => {
    const seats = [{ name: 'u6d4b-u8bd5', handle: 'u6d4b-u8bd5', display_name: '测试助手' }] as GroupMember[]
    const source = '@u6d4b-u8bd5 看一下 ops@u6d4b-u8bd5'
    const html = renderToStaticMarkup(<>{renderGroupMentionText(source, seats)}</>)
    expect(html.replace(/<[^>]+>/g, '')).toBe('@测试助手 看一下 ops@u6d4b-u8bd5')
    expect(html.match(/data-ref="agent"/g) ?? []).toHaveLength(1)
    expect(source).toBe('@u6d4b-u8bd5 看一下 ops@u6d4b-u8bd5')
  })

  it('decorates only direct Markdown prose nodes with exact immutable addresses', () => {
    const decorate = addressedGroupMentionText([{ handle: 'u6d4b-u8bd5', label: '测试助手' }])

    const children = [
      '@u6d4b-u8bd5 ',
      <code key="code">@u6d4b-u8bd5</code>,
      <a href="https://example.com/@u6d4b-u8bd5" key="link">
        @u6d4b-u8bd5
      </a>,
      ' @u6d4b-u8bd5-extra'
    ]

    const html = renderToStaticMarkup(<>{decorate(children)}</>)
    expect(html.match(/data-ref="agent"/g) ?? []).toHaveLength(1)
    expect(html).toContain('<code>@u6d4b-u8bd5</code>')
    expect(html).toContain('href="https://example.com/@u6d4b-u8bd5"')
    expect(html).toContain('@u6d4b-u8bd5-extra')
  })

  it('uses the same readable search projection while preserving fenced code and inline literals', () => {
    const identities = [{ handle: 'u6d4b-u8bd5', label: '测试助手' }]
    const text = '@u6d4b-u8bd5\n\n```text\n@u6d4b-u8bd5\n```\n\n`@u6d4b-u8bd5` [@u6d4b-u8bd5](https://example.com)'
    expect(readableGroupMentionSearch(text, identities)).toBe(
      '@测试助手\n\n```text\n@u6d4b-u8bd5\n```\n\n`@u6d4b-u8bd5` [@u6d4b-u8bd5](https://example.com)'
    )
  })
})
