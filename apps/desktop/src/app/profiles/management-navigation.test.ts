import { afterEach, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { $activeGatewayProfile, $profileOrder, $profiles } from '@/store/profile'

import { navigateManagedBot, openBotSlot } from './management-navigation'

const disposers: Array<() => void> = []

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  $activeGatewayProfile.set('default')
  $profiles.set([])
  $profileOrder.set([])
})

it('opens the requested bot in saved order without switching the ordinary assistant', async () => {
  const open = vi.fn(async () => true)
  const navigate = vi.fn()
  disposers.push(registry.register({ area: 'profiles.manager', id: 'bots', data: { open } }))
  $profiles.set([
    { name: 'default', is_default: true },
    { name: 'writer', is_default: false },
    { name: 'reviewer', is_default: false }
  ] as never)
  $profileOrder.set(['reviewer', 'writer'])

  openBotSlot(1, navigate)

  await vi.waitFor(() => expect(open).toHaveBeenCalledWith('reviewer'))
  expect($activeGatewayProfile.get()).toBe('default')
  expect(navigate).not.toHaveBeenCalled()
  openBotSlot(10, navigate)
  expect(open).toHaveBeenCalledTimes(1)
})

it('cycles the selected bot through its owner instead of the ordinary active profile', async () => {
  const cycle = vi.fn(async () => true)
  disposers.push(registry.register({ area: 'profiles.manager', id: 'bots', data: { cycle } }))

  navigateManagedBot({ direction: -1 }, vi.fn())

  await vi.waitFor(() => expect(cycle).toHaveBeenCalledWith(-1))
  expect($activeGatewayProfile.get()).toBe('default')
})

it('offers the manager when no bot navigation capability is available', () => {
  const navigate = vi.fn()
  $activeGatewayProfile.set('existing-owner')

  navigateManagedBot({ profile: 'writer' }, navigate)

  expect(navigate.mock.calls[0]?.[0]).toBe('/profiles')
  expect($activeGatewayProfile.get()).toBe('existing-owner')
})
