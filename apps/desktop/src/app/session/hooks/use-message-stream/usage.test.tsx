import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $currentUsage } from '@/store/session'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'

const SID = 'session-1'
// $currentUsage mirrors the primary session; ClientSessionState.usage drives
// the same status bar when a secondary tile is focused.
const BASELINE = { calls: 2, input: 500, output: 40, total: 540 }

let stream: MessageStreamHarness
let sessionStates = new Map<string, ClientSessionState>()

function mountStream() {
  stream = renderMessageStream(SID, { states: sessionStates })
}

describe('useMessageStream status-bar usage scoping', () => {
  beforeEach(() => {
    sessionStates = new Map([[SID, { ...createClientSessionState(), usage: { ...BASELINE } }]])
    $currentUsage.set({ ...BASELINE })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('merges a live session.usage tick from the focused session', () => {
    mountStream()

    act(() =>
      stream.handleEvent({
        payload: { usage: { context_percent: 42, input: 1200, total: 1280 } },
        session_id: SID,
        type: 'session.usage'
      })
    )

    // Merge, not replace: fields absent from the tick keep their prior values.
    expect($currentUsage.get()).toEqual({ ...BASELINE, context_percent: 42, input: 1200, total: 1280 })
    expect(sessionStates.get(SID)?.usage).toEqual({
      ...BASELINE,
      context_percent: 42,
      input: 1200,
      total: 1280
    })
  })

  it('caches a background session.usage tick without overwriting the primary status bar', () => {
    mountStream()

    act(() =>
      stream.handleEvent({
        payload: { usage: { input: 9999, total: 9999 } },
        session_id: 'background-session',
        type: 'session.usage'
      })
    )

    expect($currentUsage.get()).toEqual(BASELINE)
    expect(sessionStates.get('background-session')?.usage).toEqual({
      calls: 0,
      input: 9999,
      output: 0,
      total: 9999
    })
  })

  it('applies message.complete usage from the focused session', () => {
    mountStream()

    act(() =>
      stream.handleEvent({
        payload: { text: 'done', usage: { calls: 3, input: 1500, output: 90, total: 1590 } },
        session_id: SID,
        type: 'message.complete'
      })
    )

    expect($currentUsage.get()).toEqual({ calls: 3, input: 1500, output: 90, total: 1590 })
  })

  it('ignores message.complete usage from a background session', () => {
    mountStream()

    act(() =>
      stream.handleEvent({
        payload: { text: 'done', usage: { calls: 9, input: 9999, output: 999, total: 9999 } },
        session_id: 'background-session',
        type: 'message.complete'
      })
    )

    expect($currentUsage.get()).toEqual(BASELINE)
  })

  it('attaches per-reply usage only to the completing session without borrowing cumulative usage', () => {
    mountStream()
    const metrics = { duration_s: 12, total_tokens: 1320, tokens_per_second: 20 }
    act(() =>
      stream.handleEvent({
        payload: { text: 'done', turn_metrics: metrics, usage: { total: 9999 } },
        session_id: 'background-session',
        type: 'message.complete'
      })
    )
    expect(sessionStates.get('background-session')?.messages.at(-1)?.turnMetrics).toEqual(metrics)
    expect(sessionStates.get(SID)?.messages).toEqual([])
    expect($currentUsage.get()).toEqual(BASELINE)
  })

  it.each(['before', 'after'])(
    'merges late billing receipts and non-Aino call facts %s completion only into their original turn',
    order => {
      mountStream()

      const billing = {
        calls: [{ call_id: 'cbec3bce-4de2-4fbe-a6ee-5ab3e7d990cb', purpose: 'chat' }],
        calls_complete: false,
        revision: 1,
        session_id: '6ccf86e3-f42c-4d1b-9fbe-9b7ea58a03ca',
        source: 'aino',
        status: 'pending',
        turn_id: 'b8664a58-472a-4ba6-b853-94aadee41bb1',
        user_id: '17'
      }

      const updated = { ...billing, calls_complete: true, revision: 2 }

      const complete = () =>
        stream.handleEvent({
          type: 'message.complete',
          session_id: SID,
          payload: { text: 'done', turn_metrics: { billing, duration_s: 3 } }
        })

      const receipt = () =>
        stream.handleEvent({
          type: 'session.usage',
          session_id: SID,
          payload: { reply_billing: updated, reply_non_aino_model_calls: true }
        })

      act(() => {
        if (order === 'before') {
          receipt()
          complete()
        } else {
          complete()
          receipt()
        }
      })
      expect(sessionStates.get(SID)?.messages.at(-1)?.turnMetrics).toEqual({
        billing: updated,
        duration_s: 3,
        non_aino_model_calls: true
      })
      const messages = sessionStates.get(SID)?.messages
      act(() => stream.handleEvent({ type: 'session.usage', session_id: SID, payload: { reply_billing: billing } }))
      expect(sessionStates.get(SID)?.messages).toBe(messages)
      act(() =>
        stream.handleEvent({
          type: 'session.usage',
          session_id: SID,
          payload: { reply_billing: { ...updated, revision: 3, user_id: '18' } }
        })
      )
      expect(sessionStates.get(SID)?.messages).toBe(messages)
      expect($currentUsage.get()).toEqual(BASELINE)
    }
  )
})
