import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { en } from '@/i18n/en'
import { textPart } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { mainComposerScope } from '@/store/composer'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, $sessions } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import { useSubmitPrompt } from './submit'
import type { GatewayRequest } from './utils'

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

beforeEach(() => {
  window.localStorage.clear()
  mainComposerScope.clear()
  $sessions.set([])
  $sessionStates.set({})
  $connection.set(null)
  $activeGatewayProfile.set('default')
})

afterEach(() => {
  cleanup()
  mainComposerScope.clear()
  vi.restoreAllMocks()
})

function setupSubmit() {
  let state = createClientSessionState()

  const requestGateway = vi.fn(async (_method: string, params?: Record<string, unknown>) => ({
    admission_id: params?.submission_id,
    session_id: 'runtime-original-format',
    status: 'started'
  }))

  const deps: Parameters<typeof useSubmitPrompt>[0] = {
    activeSessionIdRef: { current: 'runtime-original-format' },
    selectedStoredSessionIdRef: { current: 'stored-original-format' },
    busyRef: { current: false },
    copy: en.desktop,
    createBackendSessionForSend: vi.fn(async () => null),
    getRoutedStoredSessionId: () => null,
    getRuntimeIdForStoredSession: () => 'runtime-original-format',
    getRouteToken: () => 'same-route',
    requestGateway: requestGateway as GatewayRequest,
    runtimeIdByStoredSessionIdRef: {
      current: new Map([['stored-original-format', 'runtime-original-format']])
    },
    resumeStoredSession: vi.fn(),
    syncAttachmentsForSubmit: async sessionId => ({ sessionId, attachments: [] }),
    updateSessionState: (_sessionId, update) => {
      state = update(state)

      return state
    }
  }

  const { result } = renderHook(() => useSubmitPrompt(deps))

  return { result, requestGateway, state: () => state }
}

describe('submission preserves original text formatting', () => {
  it('keeps code indentation and table boundaries in both the user row and gateway payload', async () => {
    const source = '\n    first line\n\tsecond line  \n\n| name | count |\n| --- | --- |\n| skill | 85 |  \n\n'
    const submit = setupSubmit()

    await act(async () => {
      expect(await submit.result.current(source)).toBe(true)
    })

    expect(submit.state().messages.find(message => message.role === 'user')?.parts).toEqual([textPart(source)])
    expect(submit.requestGateway.mock.calls.find(([method]) => method === 'prompt.submit')?.[1]?.text).toBe(source)
  })

  it('rejects an empty or whitespace-only message without creating a user row or contacting the gateway', async () => {
    const submit = setupSubmit()

    await act(async () => {
      expect(await submit.result.current('\n   \t  \n')).toBe(false)
      expect(await submit.result.current('')).toBe(false)
    })

    expect(submit.state().messages).toEqual([])
    expect(submit.requestGateway).not.toHaveBeenCalled()
  })
})
