// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type * as SessionModule from '@/store/session'

import { PetSettings } from './pet-settings'

const mocks = vi.hoisted(() => ({
  adopt: vi.fn(),
  remove: vi.fn(),
  load: vi.fn(),
  rename: vi.fn(),
  export: vi.fn(),
  scale: vi.fn(),
  enable: vi.fn(),
  request: vi.fn()
}))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway: mocks.request })
}))

vi.mock('@/components/pet/pet-thumb', () => ({ PetThumb: ({ alt }: { alt: string }) => <span>{alt} thumbnail</span> }))
vi.mock('@/store/session', async importOriginal => {
  const actual = await importOriginal<typeof SessionModule>()
  const { atom } = await import('nanostores')

  return { ...actual, $gatewayState: atom('open') }
})
vi.mock('@/store/pet-gallery', async () => {
  const { atom } = await import('nanostores')

  return {
    $petGallery: atom({
      enabled: true,
      active: 'nukey',
      pets: [
        { slug: 'nukey', displayName: 'Nukey', installed: true },
        { slug: 'custom', displayName: 'Custom', installed: true, generated: true },
        { slug: 'boba', displayName: 'Boba', installed: false }
      ]
    }),
    $petGalleryStatus: atom('ready'),
    $petGalleryError: atom(null),
    $petBusy: atom(null),
    adoptPet: (...args: unknown[]) => mocks.adopt(...args),
    removePet: (...args: unknown[]) => mocks.remove(...args),
    renamePet: (...args: unknown[]) => mocks.rename(...args),
    exportPet: (...args: unknown[]) => mocks.export(...args),
    loadPetGallery: (...args: unknown[]) => mocks.load(...args),
    loadPetThumb: vi.fn(),
    setPetEnabled: (...args: unknown[]) => mocks.enable(...args),
    setPetScale: (...args: unknown[]) => mocks.scale(...args),
    rankedGalleryPets: (gallery: { pets: { displayName: string }[] }, query: string) =>
      gallery.pets.filter(pet => pet.displayName.toLowerCase().includes(query.toLowerCase())),
    PET_SCALE_MIN: 0.1,
    PET_SCALE_MAX: 3,
    PET_SCALE_DEFAULT: 0.33
  }
})

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset())
  mocks.adopt.mockResolvedValue(true)
  mocks.remove.mockResolvedValue(true)
  mocks.rename.mockResolvedValue(true)
  mocks.export.mockResolvedValue(true)
  mocks.load.mockResolvedValue(true)
  mocks.enable.mockResolvedValue(true)
})

afterEach(cleanup)

function page() {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <PetSettings />
    </I18nProvider>
  )
}

it('keeps installed actions available and adopts a catalog pet through the existing store', async () => {
  page()
  expect(screen.getByRole('button', { name: 'Uninstall Nukey' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Browse pet catalog/ }))
  fireEvent.click(screen.getByRole('button', { name: /Boba/ }))

  await act(async () => Promise.resolve())
  expect(mocks.adopt).toHaveBeenCalledWith(mocks.request, 'boba', expect.any(String))
  expect(mocks.load).toHaveBeenCalledWith(mocks.request)
  const slider = screen.getByRole('slider')
  expect(slider.getAttribute('min')).toBe('0.1')
  expect(slider.getAttribute('max')).toBe('3')
  expect(slider.getAttribute('step')).toBe('0.05')
})

it('does not remove a generated pet until the shared confirmation is accepted', async () => {
  page()
  fireEvent.click(screen.getByRole('button', { name: 'Delete Custom' }))
  expect(mocks.remove).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }))

  await act(async () => Promise.resolve())
  expect(mocks.remove).toHaveBeenCalledWith(mocks.request, 'custom', expect.any(String))
})
