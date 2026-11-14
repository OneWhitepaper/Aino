import { describe, expect, it } from 'vitest'

import { createWindowNavigationHistory, type WindowNavigationTarget } from './window-navigation-history'

const workspace = { mode: 'sessions' as const, ownerKey: null, newSessionTarget: null }
const page = (path: string): WindowNavigationTarget => ({ path, workspace })

const chat = (storedSessionId: string): WindowNavigationTarget => ({
  path: '/primary',
  workspace,
  content: { kind: 'session', storedSessionId, scope: { workspaceMode: 'sessions' } }
})

describe('window navigation history', () => {
  it('returns through visited pages and same-route conversation tabs, retaining a forward path', () => {
    const history = createWindowNavigationHistory()
    history.observe('account-a:local', page('/'))
    expect(history.canMove(-1)).toBe(false)
    expect(history.canMove(1)).toBe(false)
    history.observe('account-a:local', chat('first'))
    history.observe('account-a:local', chat('second'))
    history.observe('account-a:local', page('/settings/models'))

    expect(history.move(-1)).toEqual(chat('second'))
    // The old content may still paint before Router commits the replay.
    history.observe('account-a:local', page('/settings/models'))
    history.observe('account-a:local', {
      ...chat('first'),
      workspace: { mode: 'bots', ownerKey: 'bot:intermediate', newSessionTarget: null }
    })
    expect(history.state.get().entries).toHaveLength(4)
    history.observe('account-a:local', chat('second'), { replace: true })
    expect(history.move(-1)).toEqual(chat('first'))
    history.observe('account-a:local', chat('first'))
    expect(history.move(1)).toEqual(chat('second'))
    history.observe('account-a:local', chat('second'))
    expect(history.state.get().entries).toHaveLength(4)
    expect(history.canMove(1)).toBe(true)

    history.observe('account-a:local', page('/capabilities'))
    expect(history.canMove(1)).toBe(false)
    expect(history.state.get().entries.map(entry => entry.path)).toEqual(['/', '/primary', '/primary', '/capabilities'])
  })

  it('replaces redirects, skips removed panes, and resets rather than restoring another authority', () => {
    const history = createWindowNavigationHistory()

    const room: WindowNavigationTarget = {
      path: '/primary',
      workspace: { mode: 'bots', ownerKey: 'group:exact', newSessionTarget: null },
      content: { kind: 'pane', paneId: 'plugin-workspace:room-exact' }
    }

    history.observe('account-a:local', page('/'))
    history.observe('account-a:local', chat('first'), { replace: true })
    expect(history.canMove(-1)).toBe(false)

    const ownRoute = {
      ...chat('first'),
      content: {
        kind: 'session' as const,
        storedSessionId: 'first',
        scope: {
          workspaceMode: 'sessions' as const,
          ownerRoute: { connectionId: 'local', profile: 'default' }
        }
      }
    }

    history.observe('account-a:local', ownRoute)
    expect(history.canMove(-1)).toBe(false)

    const otherOwner = {
      ...chat('first'),
      content: {
        kind: 'session' as const,
        storedSessionId: 'first',
        scope: {
          workspaceMode: 'sessions' as const,
          ownerRoute: { connectionId: 'local', profile: 'other-profile' }
        }
      }
    }

    history.observe('account-a:local', otherOwner)
    expect(history.canMove(-1)).toBe(true)
    history.observe('account-a:local:next', chat('first'))
    history.observe('account-a:local:next', room)
    history.observe('account-a:local:next', chat('second'))
    const stillAvailable = (target: WindowNavigationTarget) => target.content?.kind !== 'pane'
    expect(history.move(-1, stillAvailable)).toEqual(chat('first'))
    history.observe('account-a:local:next', chat('first'))

    for (const scope of ['account-b:local', 'account-b:remote', 'account-b:remote:production']) {
      history.observe(scope, page('/'))
      expect(history.canMove(-1)).toBe(false)
      expect(history.canMove(1)).toBe(false)
      history.observe(scope, chat('own-chat'))
    }

    history.observe(null, null)
    expect(history.state.get().entries).toEqual([])
  })
})
