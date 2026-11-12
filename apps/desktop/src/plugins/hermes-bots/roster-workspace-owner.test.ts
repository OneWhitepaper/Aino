import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

const fixture = vi.hoisted(() => ({
  focusedId: 'target-chat' as string | null,
  owner: { connectionId: 'source-b', profile: 'writer', authoritative: true } as {
    connectionId?: string
    profile: string
    authoritative?: boolean
  } | null,
  scope: vi.fn(),
  mode: 'sessions',
  page: false,
  ownerKey: null as string | null
}))

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    queryClient: {},
    useQuery: vi.fn(),
    useValue: vi.fn(),
    usePluginI18n: vi.fn(),
    host: {
      setWorkspaceScope: fixture.scope,
      state: {
        profile: atom('default'),
        focusedSessionOwner: { get: () => fixture.owner },
        workspaceMode: { get: () => fixture.mode },
        workspaceIsPage: { get: () => fixture.page },
        workspaceOwnerKey: { get: () => fixture.ownerKey },
        focusedStoredSessionId: { get: () => fixture.focusedId }
      }
    }
  }
})

import { $selectedRosterKey, saveSelectedRosterBot } from './bot-state'
import { adoptRequestedBotWorkspace, reconcileRosterWorkspaceOwner } from './roster-workspace-owner'

const bot = (connectionId: string): RosterRow => ({
  name: 'writer',
  connectionId,
  sourceScoped: true,
  route: { connectionId, profile: 'writer', targetProfile: 'writer', mode: 'remote' }
})

beforeEach(() => {
  fixture.scope.mockClear()
  fixture.focusedId = 'target-chat'
  fixture.owner = { connectionId: 'source-b', profile: 'writer', authoritative: true }
  fixture.mode = 'sessions'
  fixture.page = false
  fixture.ownerKey = null
  saveSelectedRosterBot(bot('source-a'))
})

describe('roster refresh workspace ownership', () => {
  it('opens the selected Bot rather than treating a retained full page as an already-fronted source', () => {
    fixture.mode = 'bots'
    fixture.ownerKey = 'bot:source-b::writer'
    fixture.page = true

    expect(adoptRequestedBotWorkspace([bot('source-a'), bot('source-b')])).toBe(false)
    expect($selectedRosterKey.get()).toBe('source-a::writer')
  })

  it('does not adopt a stale Bot scope when no source conversation is focused', () => {
    fixture.mode = 'bots'
    fixture.ownerKey = 'bot:source-b::writer'
    fixture.focusedId = null

    expect(adoptRequestedBotWorkspace([bot('source-a'), bot('source-b')])).toBe(false)
  })

  it('does not mistake an ordinary conversation for a Bot source just because its previous scope remains', () => {
    fixture.mode = 'bots'
    fixture.ownerKey = 'bot:source-b::writer'
    fixture.owner = { connectionId: 'source-b', profile: 'default', authoritative: true }

    expect(adoptRequestedBotWorkspace([bot('source-a'), bot('source-b')])).toBe(false)
  })

  it('adopts a source-selected Bot rail without opening its canonical chat or replacing the target side session', () => {
    fixture.mode = 'bots'
    fixture.ownerKey = 'bot:source-b::writer'

    expect(adoptRequestedBotWorkspace([bot('source-a'), bot('source-b')])).toBe(true)
    expect($selectedRosterKey.get()).toBe('source-b::writer')
    expect(fixture.scope).not.toHaveBeenCalled()
    expect(fixture.focusedId).toBe('target-chat')
  })

  it('keeps ordinary brand-menu entry on its established selected-bot flow', () => {
    fixture.ownerKey = 'bot:source-b::writer'

    expect(adoptRequestedBotWorkspace([bot('source-a'), bot('source-b')])).toBe(false)
    expect($selectedRosterKey.get()).toBe('source-a::writer')
  })

  it('respects an explicit Bot source while its roster is still cold', () => {
    fixture.mode = 'bots'
    fixture.ownerKey = 'bot:source-b::writer'

    expect(adoptRequestedBotWorkspace([])).toBe(true)
    expect($selectedRosterKey.get()).toBe('source-a::writer')
  })

  it('follows the focused Bot after a capsule jump instead of restoring the previously selected same-named Bot', () => {
    reconcileRosterWorkspaceOwner([bot('source-a'), bot('source-b')])

    expect($selectedRosterKey.get()).toBe('source-b::writer')
    expect(fixture.scope).toHaveBeenCalledWith('bots', 'bot:source-b::writer', {
      kind: 'route',
      route: { connectionId: 'source-b', profile: 'writer', mode: 'remote', targetProfile: 'writer' }
    })
  })

  it.each([null, { profile: 'writer', authoritative: false }, { profile: 'writer', connectionId: 'not-in-roster' }])(
    'does not claim a focused session whose exact owner is unavailable: %s',
    owner => {
      fixture.owner = owner
      reconcileRosterWorkspaceOwner([bot('source-a'), bot('source-b')])

      expect($selectedRosterKey.get()).toBe('source-a::writer')
      expect(fixture.scope).not.toHaveBeenCalled()
    }
  )

  it('retains the selected roster workspace when no conversation is open', () => {
    fixture.focusedId = null
    fixture.owner = null
    reconcileRosterWorkspaceOwner([bot('source-a'), bot('source-b')])

    expect($selectedRosterKey.get()).toBe('source-a::writer')
    expect(fixture.scope).toHaveBeenCalledWith('bots', 'bot:source-a::writer', expect.anything())
  })
})
