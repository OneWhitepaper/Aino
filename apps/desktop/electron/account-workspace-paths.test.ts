import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveDesktopHermesHome } from './data-paths'

test('platform accounts have distinct stable runtime homes outside the legacy data root', () => {
  const options = { home: '/machine', env: { HERMES_HOME: '/machine/.aino' }, platform: 'darwin' as const }

  const resolve = (userId: string, origin = 'https://api.example.com') =>
    resolveDesktopHermesHome({
      ...options,
      accountWorkspace: { userData: '/app/Aino', origin, userId }
    } as Parameters<typeof resolveDesktopHermesHome>[0])

  const a = resolve('A')
  const b = resolve('B')

  assert.notEqual(a, b)
  assert.equal(resolve('A'), a)
  assert.notEqual(resolve('A', 'https://other.example.com'), a)
  assert.ok(a.startsWith('/app/Aino/account-workspaces/'))
  assert.ok(!a.includes('/machine/.aino'))
})

test('signed-out boot never adopts the previous shared home', () => {
  const home = resolveDesktopHermesHome({
    home: '/machine',
    env: { HERMES_HOME: '/machine/.aino' },
    platform: 'darwin',
    accountWorkspace: { userData: '/app/Aino', origin: 'https://api.example.com', userId: null }
  } as Parameters<typeof resolveDesktopHermesHome>[0])

  assert.equal(home, '/app/Aino/account-workspaces/signed-out/home')
})
