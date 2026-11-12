import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type * as BotsI18n from './i18n'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { en } = await import('@/i18n/en')

  return {
    ...sdk,
    useI18n: () => ({ locale: 'en', t: en }),
    host: { ...sdk.host, state: { ...sdk.host.state, connectionId: sdk.atom('local') } }
  }
})
vi.mock('./data', async () => {
  const { atom } = await import('nanostores')

  return { $lastRoster: atom([]), $botMeta: atom({}) }
})
vi.mock('./i18n', async importOriginal => {
  const original = await importOriginal<typeof BotsI18n>()
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')

  return { ...original, useBots: () => ({ canonical: CANONICAL_GROUP_LOCALES.en, group: {} }) }
})

import { CanonicalGroupWorkingLine, canonicalMemberPhases } from './canonical-group-activity'
import { CanonicalGroupInfo } from './canonical-group-header'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import type { CanonicalPendingAction } from './canonical-groups'

const binding = { connectionId: 'local', profile: 'default', roomId: 'room' }

const members = [
  { member_id: 'a', profile: 'reviewer', handle: 'reviewer', display_name: 'Reviewer' },
  { member_id: 'b', profile: 'helper', handle: 'helper', display_name: 'Helper' }
]

interface Driver {
  working?: boolean
  member_activity?: {
    member_id: string
    status: string
    activity?: string
    task_id?: string
    execution_generation?: number
  }[]
  pending_actions?: CanonicalPendingAction[]
}

function WorkingLine({ driver }: { driver: Driver }) {
  const labels = useCanonicalGroupLabels()

  return (
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={driver}
      labels={labels}
      members={members}
      phases={canonicalMemberPhases(driver)}
    />
  )
}

afterEach(cleanup)

it.each([
  ['thinking', 'Thinking'],
  ['reading', 'Reading'],
  ['editing', 'Editing'],
  ['searching', 'Searching'],
  ['running_command', 'Running command'],
  ['browser', 'Browsing'],
  ['image', 'Generating image'],
  ['replying', 'Replying'],
  ['working', 'Working'],
  ['future-activity', 'Working'],
  [undefined, 'Working']
])('shows the gateway activity %s honestly', (activity, label) => {
  render(<WorkingLine driver={{ working: true, member_activity: [{ member_id: 'a', status: 'running', activity }] }} />)
  expect(screen.getByRole('status').textContent).toContain(`Reviewer · ${label}`)
})

it('updates each member independently and clears completed and superseded activity', () => {
  const { rerender } = render(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [
          { member_id: 'a', status: 'running', activity: 'reading', task_id: 'first', execution_generation: 1 },
          { member_id: 'b', status: 'running', activity: 'editing', task_id: 'helper', execution_generation: 1 }
        ]
      }}
    />
  )

  expect(screen.getByRole('status').textContent).toContain('Reviewer · Reading, Helper · Editing')
  rerender(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [
          { member_id: 'a', status: 'completed', activity: 'reading', task_id: 'first', execution_generation: 1 },
          { member_id: 'a', status: 'running', activity: 'thinking', task_id: 'second', execution_generation: 2 },
          { member_id: 'b', status: 'completed', activity: 'editing', task_id: 'helper', execution_generation: 1 }
        ]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Reviewer · Thinking')
  expect(screen.getByRole('status').textContent).not.toMatch(/Reading|Editing|Helper/)
  rerender(
    <WorkingLine
      driver={{ working: false, member_activity: [{ member_id: 'a', status: 'completed', activity: 'replying' }] }}
    />
  )
  expect(screen.queryByRole('status')).toBeNull()
})

it('uses queued, stopping and exact pending approval ahead of an activity', () => {
  const approval = {
    kind: 'approval',
    member_id: 'a',
    task_id: 'current',
    execution_generation: 2,
    request_id: 'approval'
  }
  const { rerender } = render(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [{ member_id: 'a', status: 'queued', activity: 'replying' }],
        pending_actions: [approval]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain(`Reviewer · ${CANONICAL_GROUP_LOCALES.en.memberQueued}`)
  rerender(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [{ member_id: 'a', status: 'stopping', activity: 'reading' }],
        pending_actions: [approval]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Reviewer · Stopping')
  rerender(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [
          {
            member_id: 'a',
            status: 'running',
            activity: 'running_command',
            task_id: 'current',
            execution_generation: 2
          }
        ],
        pending_actions: [approval]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Reviewer · Waiting for your approval')
  rerender(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [
          {
            member_id: 'a',
            status: 'running',
            activity: 'running_command',
            task_id: 'current',
            execution_generation: 3
          }
        ],
        pending_actions: [approval]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Reviewer · Running command')
})

it('does not guess an activity when more than one running attempt has the same member', () => {
  render(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [
          { member_id: 'a', status: 'running', activity: 'reading', task_id: 'old', execution_generation: 1 },
          { member_id: 'a', status: 'running', activity: 'replying', task_id: 'new', execution_generation: 2 }
        ]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Reviewer · Working')
  expect(screen.getByRole('status').textContent).not.toMatch(/Reading|Replying/)
})

it('keeps the current running activity when a later task for that member is queued', () => {
  render(
    <WorkingLine
      driver={{
        working: true,
        member_activity: [
          { member_id: 'a', status: 'running', activity: 'reading', task_id: 'current', execution_generation: 1 },
          { member_id: 'a', status: 'queued', activity: 'replying', task_id: 'next', execution_generation: 2 }
        ]
      }}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Reviewer · Reading')
  expect(screen.getByRole('status').textContent).not.toMatch(/Queued|Replying/)
})

it('keeps group information in sync with the member live status', () => {
  const driver = { working: true, member_activity: [{ member_id: 'a', status: 'running', activity: 'reading' }] }
  render(
    <CanonicalGroupInfo
      binding={binding}
      busy={false}
      driver={driver}
      onClose={vi.fn()}
      onDisband={vi.fn()}
      onRename={vi.fn()}
      phases={canonicalMemberPhases(driver)}
      room={{ room_id: 'room', name: 'Team', members }}
    />
  )
  expect(screen.getByText('Reading', { exact: true })).toBeTruthy()
})
