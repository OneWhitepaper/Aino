import { expect, test } from 'vitest'

import { createStaleGatewayRestarter } from './local-gateway'

// dokterdok N71: two owners (the multiplexer and a standalone profile with multiplex off) on the
// same stale code are two processes; the second must be restarted too, not attached as-is.
test('a second owner on the same stale code is restarted, while a served sibling shares its multiplexer restart', async () => {
  const restarted: string[] = []
  const restart = createStaleGatewayRestarter(async owner => { restarted.push(owner) }, () => undefined)
  const stale = { gateway: 'old', client: 'new' }

  const owner = (profile_id: string, control_home: null | string = null) =>
    ({ profile_id, control_home, instance_id: 'i', authority_epoch: 1, runtime_protocol: 1, api_origin: 'http://127.0.0.1:1', capabilities: [], supervisor: 'none' })

  expect(await restart(owner('/h'), stale)).not.toBeNull()
  expect(await restart(owner('/h/profiles/work'), stale)).not.toBeNull()
  // A served secondary lives in the multiplexer already restarted above: no second restart.
  expect(await restart(owner('/h/profiles/ops', '/h'), stale)).toBeNull()
  expect(restarted).toEqual(['default', 'work'])
})

test('switching accounts recovers each account home even when both use the default profile', async () => {
  const restarted: string[] = []
  const restart = createStaleGatewayRestarter(async owner => { restarted.push(owner) }, () => undefined)
  const stale = { gateway: 'old', client: 'new' }

  const owner = (home: string) => ({
    profile_id: home, instance_id: home, authority_epoch: 1, runtime_protocol: 1,
    api_origin: 'http://127.0.0.1:1', capabilities: [], supervisor: 'none'
  })

  const accountA = owner('/app/account-workspaces/account-a/home')
  const accountB = owner('/app/account-workspaces/account-b/home')

  const first = await restart(accountA, stale)
  await first?.done
  const second = await restart(accountB, stale)

  expect(second).not.toBeNull()
  await second?.done
  expect(restarted).toEqual(['default', 'default'])
  // Reconnecting either account must retain the one-attempt limit for its own owner.
  expect(await restart(accountA, stale)).toBeNull()
  expect(await restart(accountB, stale)).toBeNull()
})

test('a pending restart is shared only by profiles belonging to the same owner home', async () => {
  const finish: Array<() => void> = []
  const restart = createStaleGatewayRestarter(() => new Promise(resolve => finish.push(resolve)), () => undefined)
  const stale = { gateway: 'old', client: 'new' }

  const owner = (profile_id: string, control_home?: string) => ({
    profile_id, control_home, instance_id: profile_id, authority_epoch: 1, runtime_protocol: 1,
    api_origin: 'http://127.0.0.1:1', capabilities: [], supervisor: 'none'
  })

  const first = await restart(owner('/account-a/home'), stale)
  const sibling = await restart(owner('/account-a/home/profiles/bot', '/account-a/home'), stale)
  const other = await restart(owner('/account-b/home'), stale)

  expect(sibling?.done).toBe(first?.done)
  expect(other?.done).not.toBe(first?.done)
  expect(finish).toHaveLength(2)
  finish.forEach(done => done())
  await Promise.all([first?.done, other?.done])
})
