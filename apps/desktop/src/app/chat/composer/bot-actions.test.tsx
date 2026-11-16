import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { openToolPanelResource } from '@/app/right-sidebar/tool-panel-actions'
import { group, split } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { I18nProvider } from '@/i18n'
import { $previewTabs } from '@/store/preview'
import { $activeGatewayProfile } from '@/store/profile'
import { $selectedStoredSessionId } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { $sessionTiles } from '@/store/session-states'
import { $toolSession } from '@/store/tool-session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { BotComposerMenuActions } from './bot-actions'
import { ContextMenu } from './context-menu'
import { ComposerScopeProvider, MAIN_COMPOSER_SCOPE } from './scope'
import type { ChatBarState } from './types'

vi.mock('@/app/right-sidebar/tool-panel-actions', () => ({ openToolPanelResource: vi.fn() }))

const state: ChatBarState = {
  model: { canSwitch: true, model: 'glm-5.3-flash', provider: 'aino' },
  tools: { enabled: true, label: 'Add context' },
  voice: { active: false, enabled: true }
}

const view = {
  ...PRIMARY_SESSION_VIEW,
  kind: 'tile' as const,
  $runtimeId: atom<string | null>(null),
  $storedId: atom<string | null>('bot-chat')
}

let restore: () => void

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
  const tree = $layoutTree.get()
  const active = $activeTreeGroup.get()
  const profile = $activeGatewayProfile.get()
  const selected = $selectedStoredSessionId.get()
  const tiles = $sessionTiles.get()
  const tabs = $previewTabs.get()

  restore = () => {
    $sessionTiles.set(tiles)
    $selectedStoredSessionId.set(selected)
    $activeGatewayProfile.set(profile)
    $layoutTree.set(tree)
    $activeTreeGroup.set(active)
    $previewTabs.set(tabs)
  }

  $layoutTree.set(split('row', [group(['workspace'], { id: 'main' }), group(['session-tile:bot-chat'], { id: 'bot' })]))
  $activeTreeGroup.set('main')
  $selectedStoredSessionId.set('ordinary-chat')
  $activeGatewayProfile.set('main-user')
  $sessionTiles.set([
    {
      storedSessionId: 'bot-chat',
      ownerRoute: { connectionId: 'studio', profile: 'desktop-alias', targetProfile: 'writer-profile' }
    }
  ])
  vi.mocked(openToolPanelResource).mockReset()
})

afterEach(() => {
  cleanup()
  restore()
})

function Location() {
  const location = useLocation()

  return <output data-testid="location">{location.pathname + location.search}</output>
}

function Harness({ ownerScope = true }: { ownerScope?: boolean }) {
  return (
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <SessionViewProvider value={view}>
          <ComposerScopeProvider
            value={{
              ...MAIN_COMPOSER_SCOPE,
              ...(ownerScope ? { connectionId: 'studio', profile: 'desktop-alias' } : {}),
              target: 'tile:bot-chat'
            }}
          >
            <ContextMenu
              bot={{ actions: <BotComposerMenuActions />, onReferenceFiles: vi.fn() }}
              onInsertText={vi.fn()}
              onOpenUrlDialog={vi.fn()}
              state={state}
            />
          </ComposerScopeProvider>
        </SessionViewProvider>
        <Location />
      </I18nProvider>
    </MemoryRouter>
  )
}

function selectAction(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add context' }), { button: 0 })
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

describe('Bot composer actions', () => {
  it('keeps unresolved restored owners from opening tools through the active profile', () => {
    $sessionTiles.set([{ storedSessionId: 'bot-chat' }])
    render(<Harness ownerScope={false} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add context' }), { button: 0 })

    for (const name of ['Skills & tools', 'Open browser', 'Files & terminal']) {
      expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }

    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(openToolPanelResource).not.toHaveBeenCalled()
    expect($focusedStoredSessionId.get()).toBe('ordinary-chat')
  })

  it('opens skills for the exact backend owner without changing the active account profile', () => {
    render(<Harness />)
    selectAction('Skills & tools')
    const path = new URL(screen.getByTestId('location').textContent!, 'https://aino.test')

    expect(path.pathname).toBe('/capabilities')
    expect(Object.fromEntries(path.searchParams)).toEqual({
      tab: 'skills',
      profile: 'writer-profile',
      connection: 'studio'
    })
    expect($activeGatewayProfile.get()).toBe('main-user')
  })

  it('reopens this Bot browser without replacing its page and routes terminal to the same conversation', () => {
    const botPage = {
      kind: 'url' as const,
      label: 'Live form',
      source: 'https://example.test/form',
      url: 'https://example.test/form'
    }

    const otherPage = {
      kind: 'url' as const,
      label: 'Other chat',
      source: 'https://other.test/',
      url: 'https://other.test/'
    }

    $previewTabs.set([
      { id: 'url:bot-browser', sessionId: 'bot-chat', target: botPage },
      { id: 'url:other-browser', sessionId: 'ordinary-chat', target: otherPage }
    ])
    render(<Harness />)
    selectAction('Open browser')

    expect($focusedStoredSessionId.get()).toBe('bot-chat')
    expect($previewTabs.get()).toHaveLength(2)
    expect($previewTabs.get().find(tab => tab.id === 'url:bot-browser')?.target).toEqual(botPage)
    expect($previewTabs.get().find(tab => tab.id === 'url:other-browser')?.target).toEqual(otherPage)

    let terminalSession: string | null = null
    vi.mocked(openToolPanelResource).mockImplementation(() => {
      terminalSession = $toolSession.get().storedId
    })
    selectAction('Files & terminal')
    expect(openToolPanelResource).toHaveBeenCalledExactlyOnceWith('terminal')
    expect(terminalSession).toBe('bot-chat')
  })
})
