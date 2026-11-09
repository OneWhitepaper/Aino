import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $workspaceIsPage, syncWorkspaceRoute } from '@/app/routes'
import { findGroupOfPane, group, split } from '@/components/pane-shell/tree/model'
import { $dismissedPanes, $hiddenTreePanes, $layoutTree, $paneVisible } from '@/components/pane-shell/tree/store'
import { $workspaceMode, resetRememberedActivePanes, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import { $selectedStoredSessionId } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { switchWorkspaceScope } from './workspace-navigation'

import { host } from './index'

const disposers: (() => void)[] = []
const owner = 'bot:remote::writer'

beforeEach(() => {
  vi.useFakeTimers()
  $hiddenTreePanes.set(new Set())
  $dismissedPanes.set(new Set())
  $selectedStoredSessionId.set('ordinary-chat')
  $sessionTiles.set([
    {
      storedSessionId: 'canonical-bot',
      workspaceMode: 'bots',
      workspaceOwnerKey: owner,
      ownerRoute: { connectionId: 'remote', mode: 'remote', profile: 'writer' }
    }
  ])
  setWorkspaceScope('bots', owner)

  for (const id of ['workspace', 'sessions', 'hermes-bots:pane', 'session-tile:canonical-bot']) {
    disposers.push(
      registry.register({
        area: 'panes',
        id,
        title: id,
        render: () => null,
        data: id === 'session-tile:canonical-bot' ? { workspaceScope: { mode: 'bots', ownerKey: owner } } : undefined
      })
    )
  }

  $layoutTree.set(
    split('row', [
      group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'hermes-bots:pane' }),
      group(['workspace', 'session-tile:canonical-bot'], { id: 'content', active: 'workspace' })
    ])
  )
  window.location.hash = '#/profiles'
  syncWorkspaceRoute('/profiles')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  disposers.splice(0).forEach(dispose => dispose())
  $sessionTiles.set([])
  $selectedStoredSessionId.set(null)
  $layoutTree.set(null)
  $workspaceIsPage.set(false)
  setWorkspaceScope('sessions')
  resetRememberedActivePanes()
  window.location.hash = '#/'
})

describe('explicit workspace navigation from a full page', () => {
  it('reselects the exact already-open canonical Bot tab without replacing primary or minting tabs', () => {
    expect(host.focusOpenWorkspaceSession(owner, undefined, ['canonical-bot'])).toBe('canonical-bot')
    expect(window.location.hash).toBe('#/ordinary-chat')
    expect($workspaceIsPage.get()).toBe(false)
    expect($selectedStoredSessionId.get()).toBe('ordinary-chat')
    expect($sessionTiles.get()).toHaveLength(1)
    expect($sessionTiles.get()[0].ownerRoute).toEqual({ connectionId: 'remote', mode: 'remote', profile: 'writer' })
    expect(findGroupOfPane($layoutTree.get()!, 'session-tile:canonical-bot')?.active).toBe('session-tile:canonical-bot')
  })

  it('returns from a page to Sessions primary when the user switches modes', () => {
    $layoutTree.set(
      split('row', [
        group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'sessions' }),
        group(['workspace', 'session-tile:canonical-bot'], { id: 'content', active: 'workspace' })
      ])
    )
    switchWorkspaceScope('sessions')
    vi.runOnlyPendingTimers()

    expect(window.location.hash).toBe('#/ordinary-chat')
    expect($workspaceIsPage.get()).toBe(false)
    expect($workspaceMode.get()).toBe('sessions')
    expect(findGroupOfPane($layoutTree.get()!, 'workspace')?.active).toBe('workspace')
  })

  it.each(['/settings', '/profiles', '/capabilities'])(
    'keeps %s usable in Agent Hub and returns to the exact group on explicit reopen',
    path => {
      const groupOwner = 'group:remote::project'
      setWorkspaceScope('bots', groupOwner)

      const primary = () =>
        registry.register({
          area: 'panes',
          id: 'workspace',
          title: 'Settings host',
          render: () => null,
          data: { placement: 'main', headerVeto: $workspaceIsPage.get(), workspaceScope: { mode: 'sessions' } }
        })

      disposers.push(primary(), $workspaceIsPage.listen(primary))
      disposers.push(
        host.openWorkspace('test-group', {
          title: 'Project group',
          tabPresentation: 'conversation',
          workspaceScope: { mode: 'bots', ownerKey: groupOwner },
          render: () => null
        })
      )
      window.location.hash = `#${path}`
      syncWorkspaceRoute(path)
      vi.runOnlyPendingTimers()
      expect($workspaceIsPage.get()).toBe(true)
      expect(window.location.hash).toBe(`#${path}`)
      expect($paneVisible('workspace').get()).toBe(true)
      expect($paneVisible('plugin-workspace:test-group').get()).toBe(false)

      disposers.push(
        host.openWorkspace('test-group', {
          title: 'Project group',
          tabPresentation: 'conversation',
          workspaceScope: { mode: 'bots', ownerKey: groupOwner },
          render: () => null
        })
      )
      vi.runOnlyPendingTimers()
      expect($workspaceIsPage.get()).toBe(false)
      expect($paneVisible('plugin-workspace:test-group').get()).toBe(true)
      expect($paneVisible('session-tile:canonical-bot').get()).toBe(false)
      expect($selectedStoredSessionId.get()).toBe('ordinary-chat')
    }
  )
})
