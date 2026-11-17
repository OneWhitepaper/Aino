import assert from 'node:assert/strict'

import { test } from 'vitest'

import { fetchPrimaryProfileSessions } from './profile-session-routing'

test('mixed global remote and primary override reads the aggregate from the global backend', async () => {
  const expected = { sessions: [{ id: 'default-telegram' }], total: 1, profile_totals: { default: 1 } }
  const calls: string[] = []

  for (const prefixForMerge of [false, true]) {
    const result = await fetchPrimaryProfileSessions(
      new URLSearchParams({ profile: 'all' }),
      async () => {
        calls.push('primary')
        throw new Error('the active profile override does not serve default')
      },
      {
        prefixForMerge,
        aggregate: {
          globalRemote: true,
          primaryProfileRemoteOverride: true,
          fetchJsonForGlobalRemote: async () => {
            calls.push('global-remote')

            return expected
          }
        }
      }
    )

    assert.deepEqual(
      result.sessions.map(s => (s as { id: string }).id),
      ['default-telegram']
    )
  }

  assert.ok(!calls.includes('primary'), calls.join(','))
})

test('global remote without a primary override reuses the primary backend', async () => {
  const calls: string[] = []
  const empty = { sessions: [], total: 0, profile_totals: {} }

  await fetchPrimaryProfileSessions(
    new URLSearchParams({ profile: 'all' }),
    async () => {
      calls.push('primary')

      return empty
    },
    {
      aggregate: {
        globalRemote: true,
        primaryProfileRemoteOverride: false,
        fetchJsonForGlobalRemote: async () => {
          calls.push('global-remote')

          return empty
        }
      }
    }
  )

  assert.deepEqual(calls, ['primary'])
})
