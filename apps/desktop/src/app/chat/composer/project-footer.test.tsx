import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $interfaceMode } from '@/store/interface-mode'
import { $projectTree } from '@/store/projects'
import { $activeSessionId, $currentCwd, $newChatWorkspaceTarget, $selectedStoredSessionId } from '@/store/session'
import { stubMenuDomApis } from '@/test/jsdom'

import type { ChatBarState } from './types'

import { ChatBar } from './index'

const state: ChatBarState = {
  model: { canSwitch: false, model: '', provider: '' },
  tools: { enabled: false, label: '' },
  voice: { enabled: false, active: false }
}

let restore: () => void

beforeEach(() => {
  const mode = $interfaceMode.get()
  const projects = $projectTree.get()
  const cwd = $currentCwd.get()
  const active = $activeSessionId.get()
  const selected = $selectedStoredSessionId.get()
  const target = $newChatWorkspaceTarget.get()

  restore = () => {
    $interfaceMode.set(mode)
    $projectTree.set(projects)
    $currentCwd.set(cwd)
    $activeSessionId.set(active)
    $selectedStoredSessionId.set(selected)
    $newChatWorkspaceTarget.set(target)
  }

  $interfaceMode.set('advanced')
  $projectTree.set([
    { id: 'footer-project', label: 'Footer project', path: '/footer-project', repos: [], sessionCount: 0 }
  ])
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $currentCwd.set('')
  $newChatWorkspaceTarget.set(null)
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  restore()
})

function Composer({ homeLayout = false }: { homeLayout?: boolean }) {
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
            homeLayout={homeLayout}
            onCancel={vi.fn()}
            onSubmit={async () => true}
            state={state}
          />
        </I18nProvider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  )
}

it('keeps conversation project selection outside the input card while retaining the existing draft route action', () => {
  const { container } = render(<Composer />)
  const selector = screen.getByRole('button', { name: 'Select project' })

  expect(selector.closest('[data-slot="composer-project-footer"]')).toBeTruthy()
  expect(selector.closest('[data-slot="composer-surface"]')).toBeNull()
  fireEvent.pointerDown(selector, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(screen.getByRole('menuitem', { name: 'Footer project' }))
  expect($newChatWorkspaceTarget.get()).toBe('/footer-project')
  expect($currentCwd.get()).toBe('/footer-project')
  expect(container.querySelector('[data-slot="composer-rich-input"]')).toBeTruthy()
})

it('retains the home project context inside its existing card', () => {
  render(<Composer homeLayout />)
  expect(screen.getByRole('button', { name: 'Select project' }).closest('[data-slot="composer-surface"]')).toBeTruthy()
})
