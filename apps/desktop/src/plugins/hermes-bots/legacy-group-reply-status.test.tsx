import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { GroupActivityEntry } from './group-activity'
import { translateBots } from './i18n-test-helper'
import { LegacyGroupReplyStatus } from './legacy-group-reply-status'

vi.mock('@hermes/plugin-sdk', async importOriginal => ({
  ...(await importOriginal<typeof HermesSdk>()),
  usePluginI18n: () => translateBots
}))

afterEach(cleanup)

const room = { running: true, turn: { name: 'reviewer' }, log: [], watermarks: {} }
const meta = { reviewer: { title: 'Reviewer', custom: true, image: '/avatars/reviewer.png' } }

const activity: GroupActivityEntry[] = [
  { epoch: 1, at: 1, kind: 'replied', member: 'other', thread: 'older-thread' },
  { epoch: 1, at: 2, kind: 'replied', member: 'helper', thread: 'current-thread' },
  { epoch: 1, at: 3, kind: 'queued', member: 'reviewer', thread: 'current-thread' },
  { epoch: 1, at: 4, kind: 'working', member: 'reviewer', thread: 'current-thread' }
]

it('reuses the reply presentation with current-thread activity while leaving Stop to the existing coordinator', () => {
  const onStop = vi.fn()
  render(
    <LegacyGroupReplyStatus activity={activity} allMeta={meta} onStop={onStop} room={room} waitingForAnswer={false} />
  )
  const status = screen.getByRole('status')
  expect(status.textContent).toContain('Reviewer · Replying')
  expect(status.textContent).toContain('1 replies completed')
  expect(status.textContent).not.toContain('members queued')
  expect(status.querySelector('img')?.getAttribute('src')).toBe('/avatars/reviewer.png')
  fireEvent.click(screen.getByRole('button', { name: 'Stop this round' }))
  expect(onStop).toHaveBeenCalledOnce()
})

it('keeps a member question honest and removes the progress controls after settlement', () => {
  const { rerender } = render(
    <LegacyGroupReplyStatus activity={activity} allMeta={meta} onStop={vi.fn()} room={room} waitingForAnswer />
  )
  expect(screen.getByRole('status').textContent).not.toContain('Replying')
  rerender(
    <LegacyGroupReplyStatus
      activity={activity}
      allMeta={meta}
      onStop={vi.fn()}
      room={{ ...room, running: false }}
      waitingForAnswer={false}
    />
  )
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})
