import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'

import { ProfileCreateDialogHost } from './create-profile-dialog-host'

vi.mock('../routes', () => ({
  PROFILES_ROUTE: '/profiles',
  navigateToWorkspacePage: (navigate: (path: string) => void, path: string) => navigate(path)
}))

const disposers: Array<() => void> = []

function RouteProbe() {
  const location = useLocation()

  return <output data-testid="location">{location.pathname}</output>
}

function mountHost() {
  render(
    <MemoryRouter>
      <ProfileCreateDialogHost />
      <RouteProbe />
    </MemoryRouter>
  )
}

const { createRequest, profiles, refreshActiveProfile, selectProfile } = vi.hoisted(() => ({
  createRequest: require('nanostores').atom(0),
  profiles: require('nanostores').atom([{ is_default: true, name: 'default' }]),
  refreshActiveProfile: vi.fn(async () => undefined),
  selectProfile: vi.fn()
}))

vi.mock('@/store/profile', () => ({
  $profileCreateRequest: createRequest,
  $profiles: profiles,
  refreshActiveProfile,
  selectProfile
}))

vi.mock('./create-profile-dialog', () => ({
  CreateProfileDialog: ({
    onCreated,
    open,
    profiles
  }: {
    onCreated?: (name: string) => void
    open: boolean
    profiles: Array<{ name: string }>
  }) =>
    open ? (
      <button
        aria-label="create dialog"
        data-profile-count={profiles.length}
        onClick={() => onCreated?.('new-profile')}
        type="button"
      >
        Create
      </button>
    ) : null
}))

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  createRequest.set(0)
  profiles.set([{ is_default: true, name: 'default' }])
  refreshActiveProfile.mockClear()
  selectProfile.mockClear()
})

describe('ProfileCreateDialogHost', () => {
  it('opens from the global profile-create request while the chat surface is mounted', async () => {
    mountHost()

    expect(screen.queryByRole('button', { name: 'create dialog' })).toBeNull()

    await act(async () => {
      createRequest.set(1)
    })

    expect(screen.getByRole('button', { name: 'create dialog' }).getAttribute('data-profile-count')).toBe('1')
  })

  it('keeps ordinary conversations on their owner after creating a bot in the fallback dialog', async () => {
    mountHost()

    await act(async () => {
      createRequest.set(1)
    })
    await act(async () => {
      screen.getByRole('button', { name: 'create dialog' }).click()
    })

    expect(refreshActiveProfile).toHaveBeenCalledTimes(1)
    expect(selectProfile).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/profiles')
  })

  it('uses the contributed bot creator from global create shortcuts', async () => {
    const create = vi.fn()
    disposers.push(registry.register({ area: 'profiles.manager', id: 'bots', data: { create } }))
    mountHost()

    await act(async () => createRequest.set(1))

    expect(create).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'create dialog' })).toBeNull()
    expect(screen.getByTestId('location').textContent).toBe('/profiles')
    expect(selectProfile).not.toHaveBeenCalled()
  })
})
