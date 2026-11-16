import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $workspaceOwnerLabels, WORKSPACE_AVATAR_AREA } from '@/components/pane-shell/workspace-scope'
import { registry } from '@/contrib'
import { $sessions } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { BotConversationHeader } from './bot-conversation-header'

const { menu } = vi.hoisted(() => ({ menu: vi.fn() }))
vi.mock('./sidebar/session-actions-menu', () => ({
  SessionActionsMenu: (props: { children: React.ReactNode }) => {
    menu(props)

    return <>{props.children}</>
  }
}))

let dispose: () => void
let restore: () => void

beforeEach(() => {
  menu.mockClear()
  const sessions = $sessions.get()
  const tiles = $sessionTiles.get()
  const labels = $workspaceOwnerLabels.get()

  restore = () => {
    $sessions.set(sessions)
    $sessionTiles.set(tiles)
    $workspaceOwnerLabels.set(labels)
  }

  $sessions.set([])
  $sessionTiles.set([
    {
      storedSessionId: 'hidden-bot',
      ownerRoute: { connectionId: 'studio', mode: 'remote', profile: 'writer', targetProfile: 'backend-writer' }
    }
  ])
  $workspaceOwnerLabels.set({ 'bot:studio::writer': 'Studio writer' })
  dispose = registry.register({
    id: 'test.identity',
    area: WORKSPACE_AVATAR_AREA,
    data: { avatarFor: () => null, headerFor: (owner: string) => <span>{owner}</span> }
  })
})

afterEach(() => {
  cleanup()
  dispose()
  restore()
})

it('supplies a hidden canonical chat’s exact target Profile to session actions without a loaded row', () => {
  render(<BotConversationHeader onDelete={vi.fn()} ownerKey="bot:studio::writer" sessionId="hidden-bot" />)
  expect(screen.getByText('bot:studio::writer')).toBeTruthy()
  expect(menu).toHaveBeenLastCalledWith(
    expect.objectContaining({
      profile: 'backend-writer',
      sessionId: 'hidden-bot',
      title: 'Studio writer',
      renameable: false
    })
  )
})

it('does not wire a tile Pin to the selected primary session callback', () => {
  render(<BotConversationHeader onDelete={vi.fn()} ownerKey="bot:studio::writer" sessionId="hidden-bot" />)
  expect(menu.mock.lastCall?.[0].onPin).toBeUndefined()
})

it('uses the owning workspace actions with the exact session instead of ordinary chat actions', () => {
  dispose()
  const actions = vi.fn((owner: string, session: string) => <span>{`${owner}/${session}`}</span>)
  dispose = registry.register({
    id: 'test.bot-actions',
    area: WORKSPACE_AVATAR_AREA,
    data: { avatarFor: () => null, headerFor: () => <span>Bot identity</span>, actionsFor: actions }
  })
  render(<BotConversationHeader onDelete={vi.fn()} ownerKey="bot:studio::writer" sessionId="hidden-bot" />)
  expect(screen.getByText('bot:studio::writer/hidden-bot')).toBeTruthy()
  expect(actions).toHaveBeenCalledWith('bot:studio::writer', 'hidden-bot')
  expect(menu).not.toHaveBeenCalled()
})
