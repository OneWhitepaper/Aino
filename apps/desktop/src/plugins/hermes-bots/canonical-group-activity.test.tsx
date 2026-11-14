import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, host: { ...sdk.host, state: { ...sdk.host.state, connectionId: sdk.atom('local') } } }
})
vi.mock('./data', async () => {
  const { atom } = await import('nanostores')

  return {
    $lastRoster: atom([{ name: 'reviewer', connectionId: 'local' }]),
    $botMeta: atom({ reviewer: { title: 'Design reviewer', custom: true, image: '/avatars/reviewer.png' } })
  }
})

import { CanonicalGroupWorkingLine, canonicalMemberPhases } from './canonical-group-activity'
import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'

const labels = CANONICAL_GROUP_LOCALES.en
const binding = { connectionId: 'local', profile: 'default', roomId: 'room' }

const members = [
  { member_id: 'a', profile: 'reviewer', handle: 'design', display_name: 'Reviewer' },
  { member_id: 'b', profile: 'helper', handle: 'helper', display_name: 'Helper' }
]

afterEach(cleanup)

it('shows the current configured avatar and name, a real queue count and one Stop action', () => {
  const driver = {
    working: true,
    member_activity: [
      { member_id: 'a', status: 'running' },
      { member_id: 'b', status: 'queued' }
    ],
    counts: { succeeded: 900 }
  }

  const onStop = vi.fn()
  render(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={driver}
      labels={labels}
      members={members}
      onStop={onStop}
      phases={canonicalMemberPhases(driver)}
    />
  )
  const status = screen.getByRole('status')
  expect(status.textContent).toContain('Design reviewer · Working')
  expect(status.textContent).toContain('1 members queued')
  expect(status.textContent).not.toContain('900')
  expect(status.querySelector('img')?.getAttribute('src')).toBe('/avatars/reviewer.png')
  fireEvent.click(screen.getByRole('button', { name: labels.stopRound }))
  expect(onStop).toHaveBeenCalledOnce()
})

it('keeps stopping distinct from replying and disables a second Stop while it settles', () => {
  const driver = {
    working: true,
    member_activity: [
      { member_id: 'a', status: 'queued' },
      { member_id: 'a', status: 'stopping' },
      { member_id: 'a', status: 'running' }
    ]
  }

  render(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={driver}
      labels={labels}
      members={members}
      onStop={vi.fn()}
      phases={canonicalMemberPhases(driver)}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Design reviewer · Stopping')
  expect(screen.getByRole('status').textContent).not.toContain('Replying')
  expect((screen.getByRole('button', { name: labels.stopRound }) as HTMLButtonElement).disabled).toBe(true)
})

it('announces a pending approval without pretending the member is generating a reply', () => {
  const driver = {
    working: true,
    member_activity: [{ member_id: 'a', status: 'running' }],
    pending_actions: [
      { kind: 'approval', member_id: 'a', task_id: 'task', execution_generation: 2, request_id: 'approval' }
    ]
  }

  render(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={driver}
      labels={labels}
      members={members}
      phases={canonicalMemberPhases(driver)}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('Design reviewer · Waiting for your approval')
})

it('does not treat a queue-only member, unknown status or terminal task as replying', () => {
  const driver = {
    working: true,
    member_activity: [
      { member_id: 'b', status: 'queued' },
      { member_id: 'a', status: 'completed' },
      { member_id: 'c', status: 'future-status' }
    ]
  }

  expect([...canonicalMemberPhases(driver)]).toEqual([['b', 'queued']])
  render(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={driver}
      labels={labels}
      members={members}
      phases={canonicalMemberPhases(driver)}
    />
  )
  expect(screen.getByRole('status').textContent).toContain(`Helper · ${labels.memberQueued}`)
  expect(screen.getByRole('status').textContent).not.toContain('Replying')
})

it('retains honest generic activity for older gateways and disappears only when activity clears', () => {
  const { rerender } = render(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={{ working: true }}
      labels={labels}
      members={members}
      onStop={vi.fn()}
      phases={new Map()}
    />
  )

  expect(screen.getByRole('status').textContent).toContain(labels.groupWorking)
  rerender(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={{ working: false }}
      labels={labels}
      members={members}
      onStop={vi.fn()}
      phases={new Map()}
    />
  )
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})

it('uses a readable fallback for an unavailable roster member and keeps approval distinct from generation', () => {
  const driver = {
    working: true,
    member_activity: [{ member_id: 'mem_internal-identifier', status: 'running' }],
    pending_actions: [
      {
        kind: 'approval',
        member_id: 'mem_internal-identifier',
        task_id: 'task',
        execution_generation: 2,
        request_id: 'approval'
      }
    ]
  }

  const { container } = render(
    <CanonicalGroupWorkingLine
      binding={binding}
      driver={driver}
      labels={labels}
      members={members}
      phases={canonicalMemberPhases(driver)}
    />
  )

  expect(screen.getByRole('status').textContent).toContain(`${labels.memberGeneric} · ${labels.memberApproval}`)
  expect(screen.getByRole('status').textContent).not.toContain('mem_internal-identifier')
  expect(container.querySelector('.aino-group-round-status')?.getAttribute('data-phase')).toBe('approval')
})
