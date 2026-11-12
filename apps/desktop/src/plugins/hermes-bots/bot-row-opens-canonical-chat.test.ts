/**
 * A bot row click lands on the bot's canonical Bot Chat — the session the row
 * previews (`canonical_session`, resolved by name on every roster poll).
 *
 * The regression this pins: a plain click used to front whatever
 * bots-workspace tab the user last had open for that bot. A `+` side thread
 * persisted in Local Storage across restarts and won every click forever while
 * the row kept previewing the Bot Chat — sidebar and center described two
 * different conversations ("[Bots] - Sessions is not in sync again").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CanonicalChat from './canonical-chat'
import type { RosterRow } from './types'

const { notifyBotOpenFailure, openBotCanonicalChat, prepareBotSource } = vi.hoisted(() => ({
  notifyBotOpenFailure: vi.fn(),
  openBotCanonicalChat: vi.fn(),
  prepareBotSource: vi.fn()
}))

vi.mock('./canonical-chat', async () => ({
  CANONICAL_CHAT_TITLE: 'Bot Chat',
  ensureBotMetadata: vi.fn(async () => ({})),
  isStaleBotChatTile: (await vi.importActual<typeof CanonicalChat>('./canonical-chat')).isStaleBotChatTile,
  notifyBotOpenFailure,
  openBotCanonicalChat,
  prepareBotSource,
  PROFILE_SESSION_LIST_LIMIT: 200
}))

const { host } = await import('@hermes/plugin-sdk')
const { $openBotChat, $selectedBot, $selectedRosterKey } = await import('./bot-state')
const { openRosterBot, trackInboundActivity } = await import('./roster-actions')

const bot = { connectionId: 'local', name: 'alpha' } as RosterRow
let focusedSessionId: null | string = null

/** The plugin reads the visible session from its host, not the hidden primary. */
function focusBotChat(storedSessionId = 'bot-chat-tip') {
  focusedSessionId = storedSessionId
}

beforeEach(() => {
  vi.clearAllMocks()
  focusedSessionId = null
  vi.spyOn(host.state.focusedStoredSessionId, 'get').mockImplementation(() => focusedSessionId)
  prepareBotSource.mockReset().mockResolvedValue(undefined)
  openBotCanonicalChat.mockReset().mockResolvedValue({ openedId: 'bot-chat-tip', registryId: 'bot-chat' })
  $openBotChat.set(null)
  $selectedBot.set('')
})

afterEach(() => {
  vi.restoreAllMocks()
  focusedSessionId = null
  // @ts-expect-error — restore the harness default (no focus verb).
  delete host.focusOpenWorkspaceSession
})

describe('a row click lands on the canonical chat, never a remembered side tab', () => {
  const canonicalBot = {
    ...bot,
    canonical_session: { id: 'bot-chat', resolved_id: 'bot-chat-tip' }
  } as RosterRow

  it('fronts an open Bot Chat tab without a registry round-trip, side tabs excluded', async () => {
    const focus = vi.fn((_key: string, _probe: unknown, only?: readonly string[]) =>
      only?.includes('bot-chat-tip') ? 'bot-chat-tip' : null
    )

    host.focusOpenWorkspaceSession = focus as never

    await expect(openRosterBot(canonicalBot)).resolves.toBe(true)

    expect(focus).toHaveBeenCalledWith('bot:alpha', expect.any(Function), ['bot-chat', 'bot-chat-tip'])
    expect(openBotCanonicalChat).not.toHaveBeenCalled()
    expect($openBotChat.get()).toEqual({
      key: 'local::alpha',
      openedRegistryId: 'bot-chat',
      openedSessionId: 'bot-chat-tip'
    })
  })

  it.each([false, true])('explicitly reselects an already-open Bot Chat (busy: %s)', async isBusy => {
    // The front is presentation-only: the pane keeps whatever transcript it
    // last painted, which can predate rows the bot wrote while the user was
    // elsewhere (a cron delivery, a teammate's message_agent, another bot's
    // turn). Fronting must force a registry open so forceResume re-pulls the
    // latest rows instead of leaving a stale snapshot until the next turn
    // (#99393 class; #95600 only covered the not-yet-open path).
    host.focusOpenWorkspaceSession = vi.fn((_key: string, _probe: unknown, only?: readonly string[]) =>
      only?.includes('bot-chat-tip') ? 'bot-chat-tip' : null
    ) as never
    focusBotChat()
    const busy = vi.spyOn(host.state.busy, 'get').mockReturnValue(isBusy)

    try {
      await expect(openRosterBot(canonicalBot)).resolves.toBe(true)

      expect(openBotCanonicalChat).toHaveBeenCalledWith(
        canonicalBot,
        // An explicit row click must complete the normal hydration and model
        // recovery path, even when its existing tab was already fronted.
        { background: false, openingStillCurrent: expect.any(Function) }
      )
    } finally {
      busy.mockRestore()
      focusedSessionId = null
    }
  })

  it('offers recovery when the explicit refresh of an open Bot fails', async () => {
    host.focusOpenWorkspaceSession = vi.fn((_key: string, _probe: unknown, only?: readonly string[]) =>
      only?.includes('bot-chat-tip') ? 'bot-chat-tip' : null
    ) as never
    focusBotChat()
    const error = new Error('model_unavailable')
    openBotCanonicalChat.mockRejectedValueOnce(error)

    try {
      await openRosterBot(canonicalBot)
      expect(notifyBotOpenFailure).toHaveBeenCalledWith(error, canonicalBot, 'open')
    } finally {
      focusedSessionId = null
    }
  })

  it('resolves the registry when only a side thread is open', async () => {
    // The shell would happily front 'side-thread' — the allowlist excludes it.
    host.focusOpenWorkspaceSession = vi.fn((_key: string, _probe: unknown, only?: readonly string[]) =>
      only?.includes('side-thread') ? 'side-thread' : null
    ) as never

    await expect(openRosterBot(canonicalBot)).resolves.toBe(true)

    expect(openBotCanonicalChat).toHaveBeenCalledWith(canonicalBot, {
      intent: 'in-place',
      openingStillCurrent: expect.any(Function)
    })
    expect($openBotChat.get()?.openedSessionId).toBe('bot-chat-tip')
  })

  it('a failed open records no claim', async () => {
    openBotCanonicalChat.mockRejectedValueOnce(new Error('gateway away'))

    await expect(openRosterBot(bot)).resolves.toBe(false)

    expect($openBotChat.get()).toBeNull()
  })
})

describe('the open Bot Chat follows its session on the gateway', () => {
  // The roster poll is the only signal for turns that never reach this
  // window's stream (cron bot-chat deliveries, message_agent, group rounds).
  // When the FOCUSED chat's canonical session moves, it re-resolves so the pane
  // repaints from the gateway instead of waiting for a restart (#99393).
  const activeBot = (lastActive: number) =>
    ({
      connectionId: 'local',
      name: 'alpha',
      canonical_session: { id: 'bot-chat', resolved_id: 'bot-chat-tip', last_active: lastActive }
    }) as RosterRow

  it.each([false, true])(
    'lets an explicit open finish hydration before a roster refresh (fronted: %s)',
    async fronted => {
      const hydratingBot = (lastActive: number) => ({
        ...activeBot(lastActive),
        name: `hydrating-${fronted ? 'fronted' : 'cold'}`
      })

      let finishOpen = () => undefined as void
      let started = () => undefined as void

      const openingStarted = new Promise<void>(resolve => {
        started = resolve
      })

      openBotCanonicalChat.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishOpen = () => resolve({ openedId: 'bot-chat-tip', registryId: 'bot-chat' })
            started()
          })
      )
      trackInboundActivity([hydratingBot(10)])

      if (fronted) {
        host.focusOpenWorkspaceSession = vi.fn(() => 'bot-chat-tip') as never
        focusBotChat()
      }

      const opening = openRosterBot(hydratingBot(10))
      await openingStarted
      focusBotChat()
      trackInboundActivity([hydratingBot(20)])
      finishOpen()

      await expect(opening).resolves.toBe(true)
      expect(openBotCanonicalChat).toHaveBeenCalledTimes(1)
      expect(notifyBotOpenFailure).not.toHaveBeenCalled()
      trackInboundActivity([hydratingBot(20)])
      expect(openBotCanonicalChat).toHaveBeenCalledTimes(2)
      expect(openBotCanonicalChat).toHaveBeenLastCalledWith(hydratingBot(20), {
        background: true,
        openingStillCurrent: expect.any(Function)
      })
    }
  )

  it('re-opens the focused Bot Chat when its canonical session advances', () => {
    $selectedBot.set('alpha')
    trackInboundActivity([activeBot(100)]) // seeds the watermark

    focusBotChat()
    trackInboundActivity([activeBot(200)])

    expect(openBotCanonicalChat).toHaveBeenCalledTimes(1)
    expect(openBotCanonicalChat).toHaveBeenCalledWith(activeBot(200), {
      background: true,
      openingStillCurrent: expect.any(Function)
    })
    focusedSessionId = null
  })

  it('leaves the center alone when the Bot Chat is not what is focused', () => {
    $selectedBot.set('alpha')
    focusedSessionId = 'some-group-room'
    trackInboundActivity([activeBot(300)])

    trackInboundActivity([activeBot(400)])

    expect(openBotCanonicalChat).not.toHaveBeenCalled()
    focusedSessionId = null
  })

  it('does not re-open a focused Bot Chat from roster activity while its turn is busy', () => {
    $selectedBot.set('alpha')
    focusBotChat()
    const busy = vi.spyOn(host.state.busy, 'get').mockReturnValue(true)

    try {
      trackInboundActivity([activeBot(500)])
      trackInboundActivity([activeBot(600)])

      expect(openBotCanonicalChat).not.toHaveBeenCalled()
    } finally {
      busy.mockRestore()
      focusedSessionId = null
    }
  })
})

describe('opening a Bot Chat as a stacked tab (⌘-click / "Open Bot Chat in new tab")', () => {
  it('does not open after the creation caller leaves its page during source preparation', async () => {
    let finishPrepare = () => undefined as void
    let current = true
    prepareBotSource.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishPrepare = resolve
        })
    )

    const opening = openRosterBot(bot, { openingStillCurrent: () => current })
    current = false
    finishPrepare()

    await expect(opening).resolves.toBe(false)
    expect(openBotCanonicalChat).not.toHaveBeenCalled()
    expect($openBotChat.get()).toBeNull()
  })

  it('keeps a successful open claim when its own navigation changes the caller page', async () => {
    let current = true
    openBotCanonicalChat.mockImplementationOnce(async (_bot, options) => {
      expect(options.openingStillCurrent()).toBe(true)
      current = false

      return { openedId: 'bot-chat-tip', registryId: 'bot-chat' }
    })

    await expect(openRosterBot(bot, { openingStillCurrent: () => current })).resolves.toBe(true)
    expect($openBotChat.get()?.openedSessionId).toBe('bot-chat-tip')
  })

  it('a newly created bot keeps selection, workspace ownership and its first open on the same source', async () => {
    const created = { ...bot, sourceScoped: true, connectionKind: 'local' as const }

    await expect(openRosterBot(created, { kickoff: false })).resolves.toBe(true)

    expect($selectedRosterKey.get()).toBe('local::alpha')
    expect(openBotCanonicalChat).toHaveBeenCalledWith(created, {
      intent: 'in-place',
      kickoff: false,
      openingStillCurrent: expect.any(Function)
    })
    expect($openBotChat.get()).toEqual({
      key: 'local::alpha',
      openedRegistryId: 'bot-chat',
      openedSessionId: 'bot-chat-tip'
    })
  })

  // Two Bot Chats could never be open at once: every row click spent main, so
  // the second bot replaced the first. A `tab` intent reaches the canonical
  // open so the chat stacks beside whatever main holds; a plain click keeps
  // its in-place meaning.
  it('threads a tab intent into the canonical open', async () => {
    await expect(openRosterBot(bot, { intent: 'tab' })).resolves.toBe(true)

    expect(openBotCanonicalChat).toHaveBeenCalledWith(bot, expect.objectContaining({ intent: 'tab' }))
  })

  it('a plain click still opens in place', async () => {
    await expect(openRosterBot(bot)).resolves.toBe(true)

    expect(openBotCanonicalChat).toHaveBeenCalledWith(bot, expect.objectContaining({ intent: 'in-place' }))
  })
})
