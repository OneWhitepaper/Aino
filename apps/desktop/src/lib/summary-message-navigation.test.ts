import { describe, expect, it, vi } from 'vitest'

import { navigateToSummaryMessage } from './summary-message-navigation'

describe('navigateToSummaryMessage', () => {
  it('reveals a durable row already in the virtualized DOM', async () => {
    const node = document.createElement('button')
    node.dataset.durableRowId = '42'
    node.scrollIntoView = vi.fn()
    node.focus = vi.fn()
    document.body.append(node)

    const result = await navigateToSummaryMessage({
      root: document.body,
      isCurrent: () => true,
      target: { messageId: 42, sessionId: 'session-a' }
    })

    expect(result).toBe('navigated')
    expect(node.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('backfills once, then reveals an older row without losing the session guard', async () => {
    const node = document.createElement('div')
    node.dataset.durableRowId = '7'
    node.scrollIntoView = vi.fn()
    node.focus = vi.fn()

    const result = await navigateToSummaryMessage({
      backfill: async () => {
        document.body.append(node)

        return true
      },
      root: document.body,
      isCurrent: () => true,
      target: { messageId: 7, sessionId: 'session-a' }
    })

    expect(result).toBe('navigated')
  })

  it('does not paint a stale response after a session switch', async () => {
    let current = true

    const result = await navigateToSummaryMessage({
      backfill: async () => {
        current = false

        return true
      },
      root: document.body,
      isCurrent: () => current,
      target: { messageId: 9, sessionId: 'session-a' }
    })

    expect(result).toBe('stale')
  })
})
