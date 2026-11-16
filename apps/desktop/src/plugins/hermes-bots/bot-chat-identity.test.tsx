import type * as HermesSdk from '@hermes/plugin-sdk'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { BotChatActions, BotChatIdentity } from './bot-chat-identity'
import { $editingBot } from './bot-state'
import { $botMeta, $lastRoster } from './data'
import { botsText } from './i18n'
import { translateBots } from './i18n-test-helper'
import { botWorkspaceOwnerKey } from './routing'
import type { RosterRow } from './types'

const { ensureBotProfile, notify, openModelSettings, openRosterBot, submit, searchSession, navigate, newChat } =
  vi.hoisted(() => ({
    ensureBotProfile: vi.fn(),
    notify: vi.fn(),
    openModelSettings: vi.fn(),
    openRosterBot: vi.fn(),
    submit: vi.fn(),
    searchSession: vi.fn(),
    navigate: vi.fn(),
    newChat: vi.fn()
  }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: {
      ...sdk.host,
      notify,
      openModelSettings,
      searchSession,
      navigate,
      newChat,
      composer: { ...sdk.host.composer, submit }
    },
    usePluginI18n: () => translateBots
  }
})
vi.mock('./canonical-chat', () => ({ ensureBotProfile }))
vi.mock('./roster-actions', () => ({ openRosterBot }))

const local: RosterRow = { name: 'default', connectionId: 'local', sourceScoped: true }

const remote: RosterRow = {
  name: 'default',
  connectionId: 'studio',
  connectionLabel: 'Studio',
  sourceScoped: true,
  remoteSource: true,
  route: { connectionId: 'studio', mode: 'remote', profile: 'default', targetProfile: 'backend-bot' }
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureBotProfile.mockImplementation(async bot => ({ ...bot, description: 'Hydrated profile' }))
  openModelSettings.mockReturnValue(true)
  $lastRoster.set([local, remote])
  $botMeta.set({
    'local::default': { title: 'Local assistant' },
    'studio::default': { title: 'Studio writer' }
  })
  $editingBot.set(null)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  $lastRoster.set([])
  $botMeta.set({})
  $editingBot.set(null)
})

function renderIdentity(bot = remote) {
  return render(
    <BotChatIdentity
      avatarFor={key => <span data-owner={key} data-testid="owner-avatar" />}
      ownerKey={botWorkspaceOwnerKey(bot)}
    />
  )
}

function openMenu(name = 'Studio writer') {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' })
}

it('shows and updates the exact source-qualified bot identity without changing its canonical title', () => {
  const { container } = renderIdentity()

  expect(screen.getByRole('button', { name: 'Studio writer' })).toBeTruthy()
  expect(screen.getByTestId('owner-avatar').getAttribute('data-owner')).toBe('bot:studio::default')
  act(() => $botMeta.set({ ...$botMeta.get(), 'studio::default': { title: 'Updated writer' } }))
  expect(screen.getByRole('button', { name: 'Updated writer' })).toBeTruthy()
  expect($lastRoster.get()).toEqual([local, remote])

  act(() => $lastRoster.set([local]))
  expect(container.querySelector('button')).toBeNull()
})

it.each([local, remote])('opens the existing editor for the exact default Bot on $connectionId', async bot => {
  renderIdentity(bot)
  openMenu(bot === local ? 'Local assistant' : 'Studio writer')

  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().navigation.settings }))

  await waitFor(() => expect($editingBot.get()).toEqual({ ...bot, description: 'Hydrated profile' }))
  expect(ensureBotProfile).toHaveBeenCalledExactlyOnceWith(bot)
})

it('opens model settings with the exact alias target, never the same-named active Bot', async () => {
  renderIdentity()
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().editor.configureModel }))

  expect(openModelSettings).toHaveBeenCalledExactlyOnceWith(remote.route)
  expect($editingBot.get()).toBeNull()
})

it('reports a model settings source mismatch without opening another profile editor', async () => {
  openModelSettings.mockReturnValue(false)
  renderIdentity()
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().editor.configureModel }))

  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'error', message: botsText().bot.openModelSettingsSourceMismatch })
  )
  expect($editingBot.get()).toBeNull()
})

it('switches through the canonical roster action using the selected source row', async () => {
  renderIdentity()
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: /^Local assistant/ }))

  expect(openRosterBot).toHaveBeenCalledExactlyOnceWith(local)
})

it('opens management from the identity menu without switching the Bot', async () => {
  renderIdentity()
  openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().navigation.manageAll }))
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/profiles')
  expect(openRosterBot).not.toHaveBeenCalled()
})

it.each([
  ['compact', () => expect(submit).toHaveBeenCalledExactlyOnceWith('studio-chat', '/compact')],
  ['searchChat', () => expect(searchSession).toHaveBeenCalledExactlyOnceWith('studio-chat')],
  [
    'sideChat',
    () =>
      expect(newChat).toHaveBeenCalledWith(
        remote.route,
        expect.objectContaining({ workspaceOwnerKey: 'bot:studio::default' })
      )
  ]
] as const)('routes %s from chat options to the exact Bot conversation', async (label, check) => {
  render(<BotChatActions ownerKey="bot:studio::default" sessionId="studio-chat" />)
  fireEvent.keyDown(screen.getByRole('button', { name: botsText().navigation.chatOptions }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().navigation[label] }))
  check()
})
