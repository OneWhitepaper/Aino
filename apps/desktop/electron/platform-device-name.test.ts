import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'

import { expect, it, vi } from 'vitest'

import { resolveNativeComputerName } from './platform-device-name'

it('uses the friendly macOS computer name rather than the network hostname', async () => {
  const readComputerName = vi.fn(async () => '仔仔木头\n')

  expect(await resolveNativeComputerName('darwin', { readComputerName, hostname: () => 'zizimutou.local' })).toBe(
    '仔仔木头'
  )
  expect(readComputerName).toHaveBeenCalledOnce()
})

it.each(['', ' \n', 'unsafe\u202ename', 'unsafe\u0000name', new Error('unavailable')])(
  'falls back to the hostname for unavailable or unsafe computer names: %s',
  async value => {
    const readComputerName = async () => {
      if (value instanceof Error) {
        throw value
      }

      return value
    }

    expect(await resolveNativeComputerName('darwin', { readComputerName, hostname: () => 'My-Mac' })).toBe('My-Mac')
  }
)

it.each(['win32', 'linux'] as const)('reads the %s computer name without starting a macOS probe', async platform => {
  const readComputerName = vi.fn(async () => 'wrong host')

  expect(await resolveNativeComputerName(platform, { readComputerName, hostname: () => 'My computer' })).toBe(
    'My computer'
  )
  expect(readComputerName).not.toHaveBeenCalled()
})

it('keeps Unicode names within the metadata limit and falls back to the product name only when no valid machine name exists', async () => {
  expect(
    await resolveNativeComputerName('darwin', { readComputerName: async () => '😀'.repeat(81), hostname: () => '' })
  ).toBe('😀'.repeat(80))
  expect(await resolveNativeComputerName('linux', { hostname: () => '\u0000' })).toBe('Aino')
})

it('reads the actual native computer name on the running host', async () => {
  const expected =
    process.platform === 'darwin'
      ? execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 1000 }).trim()
      : hostname()

  expect(await resolveNativeComputerName(process.platform)).toBe(expected)
})
