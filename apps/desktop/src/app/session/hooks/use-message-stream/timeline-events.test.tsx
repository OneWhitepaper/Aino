import type { GatewayEventName } from '@hermes/shared'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { textPart, toChatMessages } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'

const SID = 'timeline-session'

let stream: MessageStreamHarness

const event = (type: GatewayEventName, timestamp: number, payload: Record<string, unknown> = {}) =>
  act(() => stream.handleEvent({ payload: { ...payload, timestamp }, session_id: SID, type }))

describe('live transcript timeline events', () => {
  beforeEach(async () => {
    stream = renderMessageStream(SID)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('records commentary, tool, resumed text, and turn-stop boundaries', () => {
    event('message.start', 100)
    event('message.delta', 101.125, { text: 'Let me inspect it.' })
    event('message.interim', 101.75, { already_streamed: true, text: 'Let me inspect it.' })
    event('tool.start', 102.25, { args: { path: 'README.md' }, name: 'read_file', tool_id: 'call-1' })
    event('tool.complete', 104.5, { name: 'read_file', result: { content: 'ok' }, tool_id: 'call-1' })
    event('message.delta', 105.625, { text: 'The file looks good.' })
    event('message.complete', 106.875, { text: 'The file looks good.' })

    const assistants = stream.state(SID).messages.filter(message => message.role === 'assistant') ?? []

    expect(assistants).toHaveLength(2)
    expect([assistants[0].timestamp, assistants[0].completedAt]).toEqual([101.125, 101.75])
    expect(assistants[0].parts.map(part => [part.timestamp, part.completedAt])).toEqual([[101.125, 101.75]])

    expect([assistants[1].timestamp, assistants[1].completedAt]).toEqual([102.25, 106.875])
    expect(assistants[1].parts.map(part => part.type)).toEqual(['tool-call', 'text'])
    expect(assistants[1].parts.map(part => [part.timestamp, part.completedAt])).toEqual([
      [102.25, 104.5],
      [105.625, 106.875]
    ])
  })

  it('preserves cross-channel delta order inside one flush window', () => {
    event('message.start', 200)
    event('reasoning.delta', 201.125, { text: 'Thinking first.' })
    event('message.delta', 202.25, { text: 'Then speaking.' })
    event('tool.start', 203.5, { args: {}, name: 'terminal', tool_id: 'call-2' })

    const assistant = stream.state(SID).messages.find(message => message.role === 'assistant')

    expect(assistant?.parts.map(part => part.type)).toEqual(['reasoning', 'text', 'tool-call'])
    expect(assistant?.parts.map(part => part.timestamp)).toEqual([201.125, 202.25, 203.5])
  })

  it.each(['rpc', 'rest'])('restores Responses commentary after tools like the live stream (%s)', transport => {
    const progress = '正在检查来源。\n\n随后核对调用路径。'
    const privateAnalysis = 'Private analysis mentioning 正在检查来源。 within a longer sentence.'
    const final = '来源和调用路径已经确认。'
    event('message.start', 210)
    event('reasoning.delta', 211, { text: privateAnalysis })
    event('message.interim', 212, { already_streamed: false, text: progress })
    event('tool.start', 213, { args: { path: 'README.md' }, name: 'read_file', tool_id: 'call-progress' })
    event('tool.complete', 214, { name: 'read_file', result: { content: 'ok' }, tool_id: 'call-progress' })
    event('message.complete', 215, { text: final })

    const items = [
      {
        type: 'message',
        role: 'assistant',
        phase: 'analysis',
        content: [{ type: 'output_text', text: privateAnalysis }]
      },
      { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: progress }] }
    ]

    const rows = [
      {
        role: 'assistant' as const,
        content: '',
        reasoning: `${privateAnalysis}\n\n${progress}`,
        codex_message_items: transport === 'rest' ? JSON.stringify(items) : items,
        tool_calls: [
          { id: 'call-progress', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }
        ],
        timestamp: 211
      },
      { role: 'tool' as const, tool_call_id: 'call-progress', content: '{"content":"ok"}', timestamp: 214 },
      { role: 'assistant' as const, content: final, timestamp: 215 }
    ]

    const before = JSON.stringify(rows)
    const restored = toChatMessages(rows)
    const liveParts = stream.state(SID).messages.flatMap(message => message.parts)
    const restoredParts = restored.flatMap(message => message.parts)

    expect(restoredParts.filter(part => part.type === 'text').map(part => part.text)).toEqual(
      liveParts.filter(part => part.type === 'text').map(part => part.text)
    )
    expect(liveParts.filter(part => part.type === 'text').map(part => part.displayPhase)).toEqual([
      'commentary',
      'final'
    ])
    expect(restoredParts.filter(part => part.type === 'text').map(part => part.displayPhase)).toEqual(
      liveParts.filter(part => part.type === 'text').map(part => part.displayPhase)
    )
    expect(restoredParts.filter(part => part.type === 'reasoning').map(part => part.text)).toEqual([privateAnalysis])
    expect(restoredParts.filter(part => part.type === 'tool-call').map(part => part.toolCallId)).toEqual([
      'call-progress'
    ])
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('uses the gateway event time for an error boundary', () => {
    event('message.start', 300)
    event('error', 301.875, { error: 'provider failed' })

    const assistant = stream.state(SID).messages.find(message => message.role === 'assistant')

    expect(assistant?.error).toBeTruthy()
    expect([assistant?.timestamp, assistant?.completedAt]).toEqual([301.875, 301.875])
  })

  it('uses the gateway event time for a review summary system row', () => {
    event('review.summary', 401.625, { text: 'Review saved.' })

    const system = stream.state(SID).messages.find(message => message.role === 'system')

    expect(system?.timestamp).toBe(401.625)
    expect(system?.parts[0].timestamp).toBe(401.625)
  })

  it.each([false, true])('refreshes an applied model switch without replacing a running turn (busy=%s)', busy => {
    cleanup()
    const hydrateFromStoredSession = vi.fn(async () => undefined)
    stream = renderMessageStream(SID, {
      hydrateFromStoredSession,
      states: new Map([[SID, { ...createClientSessionState(), storedSessionId: 'stored-model-switch', busy }]])
    })

    event('status.update', 450, { kind: 'model_switch', text: '' })

    if (busy) {
      expect(hydrateFromStoredSession).not.toHaveBeenCalled()
    } else {
      expect(hydrateFromStoredSession).toHaveBeenCalledWith(3, 'stored-model-switch', SID)
    }
  })

  it('shows an applied switch immediately and keeps it before a prompt sent while the event was arriving', () => {
    cleanup()
    const hydrateFromStoredSession = vi.fn(async () => undefined)

    const historyEntry = {
      role: 'user' as const,
      content: '',
      text: 'model changed',
      display_kind: 'model_switch',
      display_metadata: { previous_model: 'model-before', model: 'model-after' },
      row_id: 12,
      timestamp: 450
    }

    const previous = { id: 'old-answer', role: 'assistant' as const, parts: [textPart('Ready.')], timestamp: 449 }
    stream = renderMessageStream(SID, {
      hydrateFromStoredSession,
      states: new Map([[SID, createClientSessionState('stored-model-switch', [previous])]])
    })

    event('status.update', 450, { kind: 'model_switch', text: '', history_entry: historyEntry })

    const notice = stream.state().messages.find(message => message.modelSwitch)
    expect(notice).toMatchObject({
      role: 'system',
      rowId: 12,
      timestamp: 450,
      modelSwitch: historyEntry.display_metadata
    })
    expect(hydrateFromStoredSession).not.toHaveBeenCalled()

    // The same notification can arrive after an optimistic send, or replay
    // after stored history already supplied its durable row.
    // Deferred switches apply after the optimistic prompt was created.
    const prompt = { id: 'new-prompt', role: 'user' as const, parts: [textPart('Continue.')], timestamp: 449.5 }
    stream.states.set(SID, {
      ...stream.state(),
      messages: [previous, prompt],
      busy: true,
      awaitingResponse: true
    })
    event('status.update', 450, { kind: 'model_switch', text: '', history_entry: historyEntry })
    expect(stream.state().messages.map(message => message.role)).toEqual(['assistant', 'system', 'user'])
    expect(stream.state().awaitingResponse).toBe(true)
    event('message.start', 451)
    event('message.delta', 452, { text: 'Working.' })
    event('status.update', 453, { kind: 'model_switch', text: '', history_entry: historyEntry })

    expect(stream.state().messages.map(message => message.role)).toEqual(['assistant', 'system', 'user', 'assistant'])
    expect(stream.text()).toBe('Working.')
    expect(stream.state().busy).toBe(true)
    expect(stream.state().awaitingResponse).toBe(false)
    expect(stream.state().streamId).toBeTruthy()

    const messages = stream.state().messages
    event('status.update', 454, { kind: 'model_switch', text: '', history_entry: historyEntry })
    expect(stream.state().messages).toBe(messages)

    event('status.update', 455, {
      kind: 'model_switch',
      text: '',
      history_entry: { ...historyEntry, row_id: 13, timestamp: 455, display_metadata: { model: 'restored-model' } }
    })
    expect(stream.state().messages.at(-1)?.modelSwitch?.model).toBe('restored-model')

    const persisted = toChatMessages([historyEntry])
    stream.states.set(SID, { ...stream.state(), messages: [previous, ...persisted, prompt] })
    event('status.update', 455, { kind: 'model_switch', text: '', history_entry: historyEntry })
    expect(stream.state().messages.filter(message => message.modelSwitch)).toHaveLength(1)
  })

  it('records background model switches only in their owning session', () => {
    event('message.start', 500)
    event('message.delta', 501, { text: 'Foreground reply.' })
    const foreground = stream.state()

    act(() =>
      stream.handleEvent({
        type: 'status.update',
        session_id: 'background-session',
        payload: {
          kind: 'model_switch',
          text: '',
          history_entry: {
            role: 'user',
            text: 'model changed',
            display_kind: 'model_switch',
            timestamp: 502,
            row_id: 22,
            display_metadata: { previous_model: 'background-before', model: 'background-after' }
          }
        }
      })
    )

    expect(stream.state()).toBe(foreground)
    expect(stream.state('background-session').messages).toHaveLength(1)
    expect(stream.state('background-session').messages[0].modelSwitch?.model).toBe('background-after')
  })

  it('uses session.info time when it is the only stop boundary', () => {
    event('message.start', 500)
    event('tool.start', 501, { args: {}, name: 'terminal', tool_id: 'call-3' })
    event('session.info', 502.75, { running: false })

    const assistant = stream.state(SID).messages.find(message => message.role === 'assistant')

    expect(assistant?.completedAt).toBe(502.75)
    expect(assistant?.parts[0].completedAt).toBe(502.75)
  })
})
