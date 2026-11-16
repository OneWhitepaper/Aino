import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $workspaceIsPage, syncWorkspaceRoute } from '@/app/routes'
import { group, split } from '@/components/pane-shell/tree/model'
import { $dismissedPanes, $hiddenTreePanes, $layoutTree, $paneVisible } from '@/components/pane-shell/tree/store'
import { $workspaceMode, $workspaceOwnerKey, setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib/registry'
import { openBotRecentSession } from '@/plugins/hermes-bots/recent-session'
import { openRosterBot } from '@/plugins/hermes-bots/roster-actions'
import type { RosterRow } from '@/plugins/hermes-bots/types'
import { $activeGatewayProfile } from '@/store/profile'
import { $selectedStoredSessionId } from '@/store/session'

import { host } from './index'

const canonical = vi.hoisted(() => ({ open: vi.fn(), prepare: vi.fn(async () => undefined) }))

vi.mock('@/plugins/hermes-bots/canonical-chat', () => ({
  isStaleBotChatTile: () => () => false,
  notifyBotOpenFailure: vi.fn(),
  openBotCanonicalChat: canonical.open,
  prepareBotSource: canonical.prepare,
  resolveExpectHistory: () => true
}))

const disposers: (() => void)[] = []

const bot: RosterRow = {
  name: 'research',
  title: 'Research',
  connectionId: 'local',
  sourceScoped: true,
  route: { connectionId: 'local', mode: 'local', profile: 'research', targetProfile: 'research' }
}

function leaveManagementPage() {
  window.location.hash = '#/ordinary-chat'
  syncWorkspaceRoute('/ordinary-chat')
}

beforeEach(() => {
  vi.useFakeTimers()
  $hiddenTreePanes.set(new Set())
  $dismissedPanes.set(new Set())
  $selectedStoredSessionId.set('ordinary-chat')
  $activeGatewayProfile.set('default')
  setWorkspaceScope('sessions')

  for (const id of ['workspace', 'sessions', 'hermes-bots:pane']) {
    disposers.push(registry.register({ area: 'panes', id, title: id, render: () => null }))
  }

  $layoutTree.set(
    split('row', [
      group(['sessions', 'hermes-bots:pane'], { id: 'navigation', active: 'sessions' }),
      group(['workspace'], { id: 'content', active: 'workspace' })
    ])
  )
  window.location.hash = '#/profiles'
  syncWorkspaceRoute('/profiles')
  canonical.open.mockReset().mockImplementation(async () => {
    leaveManagementPage()

    return { openedId: 'canonical-history', registryId: 'canonical-history' }
  })
  canonical.prepare.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  disposers.splice(0).forEach(dispose => dispose())
  $layoutTree.set(null)
  $workspaceIsPage.set(false)
  $selectedStoredSessionId.set(null)
  setWorkspaceScope('sessions')
  window.location.hash = '#/'
})

function expectBotNavigation() {
  expect($workspaceIsPage.get()).toBe(false)
  expect($paneVisible('hermes-bots:pane').get()).toBe(true)
  expect($paneVisible('sessions').get()).toBe(false)
  expect($workspaceMode.get()).toBe('bots')
  expect($workspaceOwnerKey.get()).toBe('bot:local::research')
  expect($selectedStoredSessionId.get()).toBe('ordinary-chat')
  expect($activeGatewayProfile.get()).toBe('default')
}

it('fronts Bot navigation before a manager canonical open leaves the full page', async () => {
  await expect(openRosterBot(bot)).resolves.toBe(true)

  expectBotNavigation()
  expect(canonical.open).toHaveBeenCalledOnce()
})

it('fronts the same Bot navigation when management opens an existing ordinary Bot side session', async () => {
  vi.spyOn(host, 'openSession').mockImplementation(async () => leaveManagementPage())

  await expect(openBotRecentSession({ ...bot, last_session: { id: 'bot-side', title: 'Recent work' } })).resolves.toBe(
    true
  )

  expectBotNavigation()
  expect(host.openSession).toHaveBeenCalledWith(
    'bot-side',
    expect.objectContaining({ workspaceMode: 'bots', workspaceOwnerKey: 'bot:local::research' })
  )
})
