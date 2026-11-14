import { fromThreadMessageLike, getAutoStatus } from '@assistant-ui/core/internal'
import type { ExportedMessageRepository, ExternalStoreAdapter, ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { IncrementalExternalStoreRuntimeCore } from './incremental-external-store-runtime'

const STATUS = getAutoStatus(false, false, false, false, undefined)

function message(id: string, role: 'assistant' | 'system' | 'user', text: string): ThreadMessage {
  return fromThreadMessageLike({ role, content: [{ type: 'text', text }] }, id, STATUS)
}

function adapter(messages: ThreadMessage[], isRunning = true, headId = messages.at(-1)?.id): ExternalStoreAdapter {
  const messageRepository: ExportedMessageRepository = {
    headId: headId ?? null,
    messages: messages.map((item, index) => ({
      message: item,
      parentId: messages[index - 1]?.id ?? null
    }))
  }

  return { messageRepository, isRunning, onNew: async () => {} }
}

describe('running transcript placeholder identity', () => {
  it('keeps the wait after a system notice stable while preceding work streams, without persisting it', () => {
    const prompt = message('prompt', 'user', 'Search for the requirements')
    const progress = message('progress', 'assistant', 'Searching')
    const notice = message('notice', 'system', 'Self-improvement review: Memory updated')
    const core = new IncrementalExternalStoreRuntimeCore(adapter([prompt, progress, notice]))
    const thread = core.threads.getMainThreadRuntimeCore()
    const placeholder = thread.messages.at(-1)!

    expect(placeholder.role).toBe('assistant')
    expect(placeholder.metadata.isOptimistic).toBe(true)

    for (const text of ['Searching sources', 'Searching sources and checking results']) {
      core.setAdapter(adapter([prompt, message('progress', 'assistant', text), notice]))

      expect(thread.messages.at(-1)).toBe(placeholder)
      expect(thread.export().messages.map(item => item.message.id)).toEqual(['prompt', 'progress', 'notice'])
    }
  })

  it('retires placeholders when their run or real tail changes', () => {
    const prompt = message('prompt', 'user', 'Question')
    const notice = message('notice', 'system', 'Progress notice')
    const core = new IncrementalExternalStoreRuntimeCore(adapter([prompt, notice]))
    const thread = core.threads.getMainThreadRuntimeCore()
    const first = thread.messages.at(-1)!

    core.setAdapter(adapter([prompt, notice], false))
    expect(thread.messages.map(item => item.id)).toEqual(['prompt', 'notice'])
    core.setAdapter(adapter([prompt, notice]))
    const resumed = thread.messages.at(-1)!
    expect(resumed.id).not.toBe(first.id)

    const nextNotice = message('notice-2', 'system', 'Another notice')
    core.setAdapter(adapter([prompt, notice, nextNotice]))
    const next = thread.messages.at(-1)!
    expect(next.id).not.toBe(resumed.id)

    core.setAdapter(adapter([prompt, notice, nextNotice], true, 'notice'))
    const branch = thread.messages.at(-1)!
    expect(branch.id).not.toBe(next.id)
    expect(thread.messages.slice(0, -1).map(item => item.id)).toEqual(['prompt', 'notice'])

    core.setAdapter(adapter([prompt, notice, nextNotice, message('answer', 'assistant', 'Answer')]))
    expect(thread.messages.map(item => item.id)).toEqual(['prompt', 'notice', 'notice-2', 'answer'])

    core.setAdapter(adapter([message('other-prompt', 'user', 'Other conversation')]))
    const other = thread.messages.at(-1)!
    expect(other.id).not.toBe(branch.id)
    expect(thread.messages.slice(0, -1).map(item => item.id)).toEqual(['other-prompt'])
    expect(thread.export().messages.map(item => item.message.id)).toEqual(['other-prompt'])

    core.setAdapter(adapter([]))
    const empty = thread.messages.at(-1)!
    core.setAdapter(adapter([]))
    expect(thread.messages.at(-1)?.id).not.toBe(empty.id)
    expect(thread.export().messages).toHaveLength(0)
  })
})
