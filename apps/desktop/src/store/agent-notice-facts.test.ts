import { expect, it } from 'vitest'

import { noticeToToast } from './agent-notices'

it('shows explicitly supplied disk measurements and treats unavailable estimates as unknown', () => {
  const input = {
    key: 'sessions.auto_prune',
    text: 'Disk low',
    metrics: {
      free_bytes: 700 * 1024 ** 2,
      total_bytes: 256 * 1024 ** 3,
      db_bytes: 2 * 1024 ** 2,
      prunable_sessions: 9,
      total_sessions: 13,
      reclaim_bytes: 1024 ** 2,
      estimate_ok: true
    }
  }

  const notice = noticeToToast(input)
  expect(notice?.facts).toContainEqual({ label: 'Available space', value: '700 MiB' })
  expect(notice?.facts).toContainEqual({ label: 'Conversation history', value: '2 MiB' })
  expect(notice?.facts).toContainEqual({ label: 'Eligible old conversations', value: '9' })
  const unknown = noticeToToast({ ...input, metrics: { ...input.metrics, estimate_ok: false } })
  expect(unknown?.facts).toContainEqual({ label: 'Eligible old conversations', value: 'Not available' })
  expect(unknown?.facts).toContainEqual({ label: 'Estimated recoverable space', value: 'Not available' })
})

it('does not infer facts from raw report prose or add disk fields to unrelated notices', () => {
  expect(
    noticeToToast({ key: 'sessions.auto_prune', text: '12.2 GB free', detail: 'History uses 1 MB' })?.facts
  ).toBeUndefined()
  expect(noticeToToast({ key: 'credits.usage', text: '700 MB' })?.facts).toBeUndefined()
})
