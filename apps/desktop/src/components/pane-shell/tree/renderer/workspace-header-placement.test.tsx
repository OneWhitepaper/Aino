import { useStore } from '@nanostores/react'
import { cleanup, render } from '@testing-library/react'
import { atom } from 'nanostores'
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $workspaceIsPage } from '@/app/routes'
import { Slot } from '@/contrib/react/slot'
import { registry } from '@/contrib/registry'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { resetRememberedActivePanes, setWorkspaceScope } from '../../workspace-scope'
import { group } from '../model'
import { $hiddenTreePanes, $narrowViewport } from '../store'

import { WindowTitlebarContext } from './header-placement'
import { TreeGroup } from './tree-group'

const disposers: (() => void)[] = []

const conversations = [
  { kind: 'ordinary', id: 'workspace', title: 'Ordinary conversation', mode: 'sessions', ownerKey: null },
  { kind: 'bot', id: 'session-tile:writer', title: 'Writer', mode: 'bots', ownerKey: 'bot:writer' },
  { kind: 'group', id: 'plugin-workspace:project-room', title: 'Project room', mode: 'bots', ownerKey: 'group:project' }
] as const

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
  vi.stubGlobal('CSS', { ...globalThis.CSS, escape: (value: string) => value })
  $workspaceIsPage.set(false)
  $hiddenTreePanes.set(new Set())
  $narrowViewport.set(false)
  $activeSessionId.set(null)
  $selectedStoredSessionId.set('ordinary-stored-session')
  $sessionStates.set({})
  $sessionTiles.set([])
  setWorkspaceScope('sessions')
  resetRememberedActivePanes()
})

afterEach(() => {
  cleanup()
  disposers
    .splice(0)
    .reverse()
    .forEach(dispose => dispose())
  setWorkspaceScope('sessions')
  resetRememberedActivePanes()
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  $sessionStates.set({})
  $sessionTiles.set([])
  vi.unstubAllGlobals()
})

it.each(conversations)(
  'places the primary $kind title in the window bar while a split keeps its own title',
  conversation => {
    const registerPane = (id: string, title: string, primary = false) => {
      disposers.push(
        registry.register({
          area: 'panes',
          id,
          title,
          data: {
            placement: 'main',
            uncloseable: primary,
            tabPresentation: 'conversation',
            workspaceScope: primary
              ? { mode: 'sessions' }
              : { mode: conversation.mode, ownerKey: conversation.ownerKey }
          },
          render: () => null
        })
      )
    }

    registerPane('workspace', 'Ordinary conversation', true)

    if (conversation.id !== 'workspace') {
      registerPane(conversation.id, conversation.title)
    }

    const secondaryId = `plugin-workspace:${conversation.kind}-split`
    registerPane(secondaryId, 'Separate conversation')
    setWorkspaceScope(conversation.mode, conversation.ownerKey)

    const { container } = render(
      <WindowTitlebarContext.Provider value>
        <div data-test-window-bar="">
          <Slot area="titleBar.left" />
        </div>
        <TreeGroup
          node={group(conversation.id === 'workspace' ? ['workspace'] : ['workspace', conversation.id], {
            active: conversation.id,
            id: 'primary'
          })}
          parentAxis="row"
        />
        <TreeGroup node={group([secondaryId], { id: 'secondary' })} parentAxis="row" />
      </WindowTitlebarContext.Provider>
    )

    const windowBar = container.querySelector('[data-test-window-bar]')!
    const main = container.querySelector('[data-tree-group="primary"]')!
    const secondary = container.querySelector('[data-tree-group="secondary"]')!

    expect(windowBar.querySelector('[data-current-session-title]')?.textContent).toBe(conversation.title)
    expect(windowBar.querySelectorAll('[data-current-session-title]')).toHaveLength(1)
    expect(main.querySelector('[data-current-session-title]')).toBeNull()
    expect(secondary.querySelector('[data-current-session-title]')?.textContent).toBe('Separate conversation')
  }
)

it('updates a renamed group in the window title without re-registering its workspace', () => {
  const $title = atom('Project room')
  const LiveTitle = () => useStore($title)

  for (const [id, data] of [
    ['workspace', { placement: 'main', uncloseable: true, workspaceScope: { mode: 'sessions' } }],
    [
      'plugin-workspace:live-room',
      {
        placement: 'main',
        tabPresentation: 'conversation',
        workspaceScope: { mode: 'bots', ownerKey: 'group:project' },
        tabTitle: () => <LiveTitle />,
        tabTitleText: () => $title.get()
      }
    ]
  ] as const) {
    disposers.push(registry.register({ area: 'panes', id, data, title: 'Project room', render: () => null }))
  }

  setWorkspaceScope('bots', 'group:project')

  const { container } = render(
    <WindowTitlebarContext.Provider value>
      <div data-test-window-bar="">
        <Slot area="titleBar.left" />
      </div>
      <TreeGroup
        node={group(['workspace', 'plugin-workspace:live-room'], {
          active: 'plugin-workspace:live-room',
          id: 'primary'
        })}
        parentAxis="row"
      />
    </WindowTitlebarContext.Provider>
  )

  const title = () => container.querySelector('[data-test-window-bar] [data-current-session-title]')?.textContent
  expect(title()).toBe('Project room')
  act(() => $title.set('Renamed project room'))
  expect(title()).toBe('Renamed project room')
})
