import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ChatMessage, textPart } from '@/lib/chat-messages'
import { mainComposerScope } from '@/store/composer'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, $messages, $sessions } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { actRender, Harness, type HarnessHandle } from './index-test-utils'

vi.mock('@/hermes', () => ({
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session' })),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getSession: vi.fn(),
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  setApiRequestProfile: vi.fn(),
  transcribeAudio: vi.fn()
}))

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

beforeEach(() => {
  window.localStorage.clear()
  mainComposerScope.clear()
  $messages.set([])
  $sessions.set([])
  $sessionStates.set({})
  $connection.set(null)
  $activeGatewayProfile.set('default')
})

afterEach(() => {
  cleanup()
  $messages.set([])
  mainComposerScope.clear()
  vi.restoreAllMocks()
})

async function setup(seedMessages: ChatMessage[] = []) {
  let handle: HarnessHandle | null = null
  $messages.set(seedMessages)

  const requestGateway = vi.fn(
    async (_method: string, _params?: Record<string, unknown>) => ({ status: 'redirected' }) as never
  )

  await actRender(
    <Harness
      onReady={value => (handle = value)}
      refreshSessions={async () => undefined}
      requestGateway={requestGateway}
      seedMessages={seedMessages}
    />
  )

  return { handle: handle!, requestGateway }
}

describe('editing and redirecting preserve original text formatting', () => {
  it('applies an indentation-only edit without trimming the replacement sent to the gateway', async () => {
    const original: ChatMessage = { id: 'user-original', role: 'user', parts: [textPart('same code')] }
    const source = '    same code  \n\n'
    const { handle, requestGateway } = await setup([original])

    await handle.editMessage({
      content: [{ type: 'text', text: source }],
      parentId: null,
      role: 'user',
      sourceId: original.id
    } as never)

    const params = requestGateway.mock.calls.find(([method]) => method === 'prompt.submit')?.[1]
    expect(params?.text).toBe(source)
    expect(handle.state().messages.find(message => message.role === 'user')?.parts).toEqual([textPart(source)])
  })

  it('keeps a formatted correction in its user row and redirect request while blocking whitespace-only text', async () => {
    const source = '\n    use this\n\tcode instead  \n\n'
    const { handle, requestGateway } = await setup()

    expect(await handle.redirectPrompt(source)).toBe(true)
    const params = requestGateway.mock.calls.find(([method]) => method === 'session.redirect')?.[1]
    expect(params?.text).toBe(source)
    expect(handle.state().messages.find(message => message.role === 'user')?.parts).toEqual([textPart(source)])

    requestGateway.mockClear()
    expect(await handle.redirectPrompt('  \n\t ')).toBe(false)
    expect(requestGateway).not.toHaveBeenCalled()
  })

  it('leaves the original turn untouched when an edit contains only whitespace', async () => {
    const original: ChatMessage = { id: 'user-original', role: 'user', parts: [textPart('Keep this')] }
    const { handle, requestGateway } = await setup([original])

    await handle.editMessage({
      content: [{ type: 'text', text: '  \n\t ' }],
      parentId: null,
      role: 'user',
      sourceId: original.id
    } as never)

    expect(requestGateway).not.toHaveBeenCalled()
    expect(handle.state().messages).toEqual([original])
  })
})
