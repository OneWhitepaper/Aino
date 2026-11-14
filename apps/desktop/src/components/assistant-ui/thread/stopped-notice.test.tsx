import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { I18nProvider } from '@/i18n'

import {
  assistantMessage,
  stubThreadEnvironment,
  stubThreadViewportSize,
  ThreadRuntime,
  userMessage
} from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()
afterEach(cleanup)

function StoppedTranscript({ running = false }: { running?: boolean }) {
  const reply = {
    ...assistantMessage(),
    content: [{ type: 'text', text: '已完成文件检查。' }],
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { custom: { interrupted: true } }
  } as ThreadMessage

  return (
    <I18nProvider configClient={null} initialLocale="zh">
      <ThreadRuntime messages={[userMessage(), reply]}>
        <Thread />
      </ThreadRuntime>
    </I18nProvider>
  )
}

test('a paused reply announces preserved progress in the conversation language and keeps its content usable', async () => {
  render(<StoppedTranscript />)

  const notice = await screen.findByRole('status', { name: /已暂停/ })
  expect(notice.textContent).toContain('进展已保留')
  expect(screen.queryByText('Response stopped')).toBeNull()
  expect(screen.getByText('已完成文件检查。')).toBeTruthy()
  const reply = notice.closest('[data-slot="aui_assistant-message-root"]') as HTMLElement
  expect(within(reply).getByRole('button', { name: '复制' })).toBeTruthy()
})

test('a resumed reply does not keep announcing that it is paused', () => {
  render(<StoppedTranscript running />)

  expect(screen.queryByRole('status', { name: /已暂停/ })).toBeNull()
  expect(screen.getByText('已完成文件检查。')).toBeTruthy()
})
