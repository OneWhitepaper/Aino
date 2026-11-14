import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { $botChatScopes, $botChatSessionIds } from '@/store/bot-chat-scope'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $toolDisclosureStates } from '@/store/tool-view'

import { assistantMessage, stubThreadEnvironment, ThreadRuntime, userMessage } from '../test-utils'

import { Thread } from '.'

let restore: () => void

beforeEach(() => {
  stubThreadEnvironment()
  const active = $activeSessionId.get()
  const selected = $selectedStoredSessionId.get()
  const bots = $botChatSessionIds.get()
  const scopes = $botChatScopes.get()
  const disclosures = $toolDisclosureStates.get()

  restore = () => {
    $activeSessionId.set(active)
    $selectedStoredSessionId.set(selected)
    $botChatSessionIds.set(bots)
    $botChatScopes.set(scopes)
    $toolDisclosureStates.set(disclosures)
  }

  $activeSessionId.set('identity-runtime')
  $selectedStoredSessionId.set('identity-session')
  $botChatSessionIds.set(new Set())
  $toolDisclosureStates.set({})
})

afterEach(() => {
  cleanup()
  restore()
})

function Transcript({ messages }: { messages: ThreadMessage[] }) {
  return (
    <ThreadRuntime messages={messages}>
      <Thread />
    </ThreadRuntime>
  )
}

const identities = (container: HTMLElement) =>
  [
    ...container.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-brand"], [data-slot="aui_assistant-avatar"]')
  ].filter(element => !element.closest('[hidden]'))

it.each(['ordinary', 'bot'])(
  'keeps one %s portrait through partial pause, resumed thinking, text and process disclosure',
  async kind => {
    const unregister = registry.register({
      id: 'test.response-portrait',
      area: 'workspace.ownerAvatar',
      data: { avatarFor: () => <span data-testid="bot-portrait">Research bot</span> }
    })

    if (kind === 'bot') {
      $botChatSessionIds.set(new Set(['identity-session']))
      $botChatScopes.set({ 'identity-session': { workspaceMode: 'bots', workspaceOwnerKey: 'bot:local::research' } })
    }

    const prompt = userMessage('request', 'Write the recommendations.')
    const partialContent = [{ type: 'text', text: 'First recommendation.', displayPhase: 'final' }] as const

    const partial = {
      ...assistantMessage(),
      id: 'partial',
      content: partialContent,
      metadata: { custom: { interrupted: true } }
    } as ThreadMessage

    const thinking = {
      ...assistantMessage(),
      id: 'continued',
      content: [{ type: 'reasoning', text: 'Continue the remaining recommendations.' }],
      status: { type: 'running' }
    } as ThreadMessage

    try {
      const { container, rerender } = render(<Transcript messages={[prompt, partial]} />)
      const originalIdentity = identities(container)[0]
      expect(originalIdentity).toBeTruthy()

      for (const content of [
        [],
        thinking.content,
        [...thinking.content, { type: 'text', text: 'Second recommendation.', displayPhase: 'final' }]
      ]) {
        rerender(<Transcript messages={[prompt, partial, { ...thinking, content } as ThreadMessage]} />)
        await waitFor(() => expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(2))
        expect(identities(container)).toHaveLength(1)
        expect(identities(container)[0]).toBe(originalIdentity)
        expect(within(container).getByText('First recommendation.').closest('[hidden]')).toBeNull()
      }

      const completed = {
        ...thinking,
        content: [...thinking.content, { type: 'text', text: 'Second recommendation.', displayPhase: 'final' }],
        status: { type: 'complete', reason: 'stop' }
      } as ThreadMessage

      const unmodified = JSON.stringify([prompt, partial, completed])
      rerender(<Transcript messages={[prompt, partial, completed]} />)
      await waitFor(() => expect(container.querySelector('[data-slot="aui_response-process-header"]')).not.toBeNull())
      expect(identities(container)).toHaveLength(1)
      expect(identities(container)[0]?.closest('[data-role="assistant"]')?.getAttribute('data-message-id')).toBe(
        'continued'
      )

      const toggle = within(
        container.querySelector('[data-slot="aui_response-process-header"]') as HTMLElement
      ).getByRole('button')

      fireEvent.click(toggle)
      expect(identities(container)).toHaveLength(1)
      expect(within(container).getByText('First recommendation.').closest('[hidden]')).toBeNull()
      fireEvent.click(toggle)
      expect(identities(container)).toHaveLength(1)
      expect(JSON.stringify([prompt, partial, completed])).toBe(unmodified)
    } finally {
      unregister()
    }
  }
)

it('gives separate user turns their own portrait and skips a collapsed inter-agent notice', () => {
  const { container } = render(
    <Transcript
      messages={
        [
          userMessage('first', 'First request'),
          { ...assistantMessage(), id: 'first-answer' },
          userMessage('delivery', 'Message from 🤖 Research (@research): Please verify.'),
          {
            ...assistantMessage(),
            id: 'collapsed-notice',
            content: [{ type: 'text', text: 'Reply sent to research.' }]
          },
          { ...assistantMessage(), id: 'human-report', content: [{ type: 'text', text: 'Here is the human report.' }] },
          userMessage('second', 'Second request'),
          { ...assistantMessage(), id: 'second-answer' }
        ] as ThreadMessage[]
      }
    />
  )

  expect(
    identities(container).map(element => element.closest('[data-role="assistant"]')?.getAttribute('data-message-id'))
  ).toEqual(['first-answer', 'human-report', 'second-answer'])
  expect(within(container).getByText('Here is the human report.')).toBeTruthy()
})
