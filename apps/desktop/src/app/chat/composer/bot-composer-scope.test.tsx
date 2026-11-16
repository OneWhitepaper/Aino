import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $interfaceMode } from '@/store/interface-mode'
import { $selectedStoredSessionId } from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { composerPlainText } from './rich-editor'
import type { ChatBarState } from './types'

import { ChatBar } from './index'

const state: ChatBarState = {
  model: {
    canSwitch: true,
    model: 'glm-5.3-flash',
    provider: 'aino',
    reasoningMenuContent: <div>Existing reasoning choices</div>
  },
  tools: { enabled: true, label: 'Add context' },
  voice: { active: false, enabled: true }
}

let restore: () => void

beforeEach(() => {
  const scopes = $botChatScopes.get()
  const selected = $selectedStoredSessionId.get()
  const mode = $interfaceMode.get()

  restore = () => {
    $botChatScopes.set(scopes)
    $selectedStoredSessionId.set(selected)
    $interfaceMode.set(mode)
  }

  $botChatScopes.set({
    canonical: { workspaceMode: 'bots', workspaceOwnerKey: 'bot:research', workspaceTabTitle: 'Research' },
    side: { workspaceMode: 'bots', workspaceOwnerKey: 'bot:research' }
  })
  $interfaceMode.set('advanced')
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  restore()
})

function Composer() {
  const runtime = useExternalStoreRuntime({
    convertMessage: (message: ThreadMessageLike) => message,
    isRunning: false,
    messages: [] as ThreadMessageLike[],
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <ChatBar
            busy={false}
            disabled={false}
            gateway={null}
            onCancel={vi.fn()}
            onSubmit={async () => true}
            state={state}
          />
        </I18nProvider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  )
}

describe('Bot composer presentation scope', () => {
  it.each(['canonical', 'side', 'ordinary'])('keeps %s controls on their own conversation surface', storedId => {
    $selectedStoredSessionId.set(storedId)
    render(<Composer />)

    const canonical = storedId === 'canonical'

    expect(Boolean(screen.queryByRole('button', { name: /^Approval mode:/ }))).toBe(!canonical)
    expect(Boolean(screen.queryByTestId('reasoning-pill'))).toBe(!canonical)
    expect(screen.getByRole('button', { name: 'Open model picker' })).toBeTruthy()
    expect(screen.getByRole('button', { name: canonical ? 'Voice' : 'Voice dictation' })).toBeTruthy()
    expect(Boolean(screen.queryByRole('button', { name: 'Select project' }))).toBe(!canonical)
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add context' }), { button: 0, ctrlKey: false })
    expect(Boolean(screen.queryByRole('menuitem', { name: /^Approval mode:/ }))).toBe(canonical)
    expect(Boolean(screen.queryByRole('menuitem', { name: /^Effort/ }))).toBe(canonical)
    expect(Boolean(screen.queryByRole('menuitem', { name: 'Skills & tools' }))).toBe(canonical)
    expect(Boolean(screen.queryByRole('menuitem', { name: 'Select project' }))).toBe(canonical)
  })

  it('opens file completion in the existing editor and keeps the unsent draft', async () => {
    $selectedStoredSessionId.set('canonical')
    const { container } = render(<Composer />)
    const input = screen.getByRole('textbox', { name: 'Message' })

    input.focus()
    input.textContent = 'Keep my draft'
    fireEvent.input(input)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add context' }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reference project files' }))

    await waitFor(() => expect(composerPlainText(input as HTMLDivElement)).toBe('Keep my draft\n@file:'))
    expect(container.querySelectorAll('[data-slot="composer-rich-input"]')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Select project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide status stack' })).toBeNull()
    expect(screen.getByText('Model applies to this chat')).toBeTruthy()
  })
})
