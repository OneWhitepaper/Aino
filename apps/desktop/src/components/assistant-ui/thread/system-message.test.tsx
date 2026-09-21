import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { toChatMessages } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import { $displayTimestamps } from '@/store/display-timestamps'
import type { SessionMessage } from '@/types/hermes'

import { stubThreadEnvironment } from '../test-utils'

import { Thread } from '.'

// Timeline timestamps render only when `display.timestamps` is enabled.
$displayTimestamps.set(true)

const timestamp = new Date('2026-05-01T00:00:00.000Z')
stubThreadEnvironment()

function Harness({
  locale = 'en',
  text = '',
  asyncResult,
  stored
}: {
  locale?: 'en' | 'zh'
  text?: string
  asyncResult?: string
  stored?: SessionMessage
}) {
  const message = stored
    ? toRuntimeMessage(toChatMessages([stored])[0])
    : ({
        id: 'system-1',
        role: 'system',
        content: [{ type: 'text', text }],
        createdAt: timestamp,
        metadata: { custom: { timelineTimestamp: timestamp.getTime() / 1000, asyncResult } }
      } as unknown as ThreadMessage)

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [message],
    isRunning: false,
    onNew: async () => {}
  })

  return (
    <I18nProvider configClient={null} initialLocale={locale}>
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread />
      </AssistantRuntimeProvider>
    </I18nProvider>
  )
}

function expectTimestampSeparated(container: HTMLElement, precedingText: string) {
  const row = container.querySelector('[data-role="system"]')
  const stamp = row?.querySelector('[data-slot="timeline-timestamp"]')?.textContent

  expect(stamp).toBeTruthy()
  expect(row?.textContent).toContain(`${precedingText} ${stamp}`)
}

afterEach(cleanup)

describe('background report disclosure', () => {
  it('keeps result bodies out of the transcript until opened and removes them when collapsed', () => {
    const report = '{"blockers":[{"title":"Local-model readiness uses the wrong endpoint"}]}'
    const { container, getByRole } = render(<Harness asyncResult={report} text="2 background agents finished" />)

    expect(container.textContent).not.toContain('blockers')
    expectTimestampSeparated(container, '2 background agents finished')
    const toggle = getByRole('button', { name: '2 background agents finished' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain(report)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('blockers')
  })
})

describe('system message timestamp text separation', () => {
  it.each([
    [{ previous_model: 'model-before', model: 'model-after' }, '模型已从 model-before 更改为 model-after。'],
    [JSON.stringify({ model: 'model-after' }), '模型已更改为 model-after。'],
    [undefined, '模型已更改。']
  ])('renders a persisted model switch from its metadata in the selected locale', (displayMetadata, label) => {
    const { container } = render(
      <Harness
        locale="zh"
        stored={{
          role: 'user',
          content: 'private model-facing marker',
          display_kind: 'model_switch',
          display_metadata: displayMetadata,
          timestamp: timestamp.getTime() / 1000
        }}
      />
    )

    expectTimestampSeparated(container, label)
    expect(container.textContent).not.toContain('private model-facing marker')
    expect(container.textContent).not.toContain('model changed')
    expect(container.querySelector('[data-role="user"]')).toBeNull()
  })

  it('separates an ordinary system row timestamp in accessible and copied text', () => {
    const { container } = render(<Harness text="Review saved." />)

    expectTimestampSeparated(container, 'Review saved.')
  })

  it('separates a slash-status timestamp in accessible and copied text', () => {
    const { container } = render(<Harness text={'slash:/model\nmodel changed'} />)

    expectTimestampSeparated(container, 'model changed')
  })

  it('separates a steer timestamp in accessible and copied text', () => {
    const { container } = render(<Harness text="steer:rerun tests" />)

    expectTimestampSeparated(container, 'rerun tests')
  })

  it('localizes the steer marker for Simplified Chinese users', () => {
    const { container } = render(<Harness locale="zh" text="steer:rerun tests" />)

    expect(container.querySelector('[data-role="system"]')?.textContent).toContain('已引导')
    expect(container.querySelector('[data-role="system"]')?.textContent).not.toContain('steered')
  })
})
