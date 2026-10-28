import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { registerButterbar } from '@/store/butterbar'
import { $freeTierRoute, $freeTierStatus } from '@/store/free-tier'
import type { FreeTierStatus } from '@/types/hermes'

import { Butterbar } from './butterbar'
import { TermsButterbar } from './terms-butterbar'

const availableFreeTier: FreeTierStatus = {
  available: true,
  enabled: true,
  has_guest: true,
  label: 'Nous · free tier',
  model: 'nous/welcome',
  notice_pending: false
}

const disposers: (() => void)[] = []

beforeEach(() => {
  $freeTierStatus.set(availableFreeTier)
  $freeTierRoute.set(null)
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  $freeTierStatus.set(null)
  $freeTierRoute.set(null)
})

function renderNotices(locale = 'en') {
  return render(
    <I18nProvider configClient={null} initialLocale={locale}>
      <TermsButterbar />
      <Butterbar />
    </I18nProvider>
  )
}

it('shows standing terms only while the selected route actually uses the available Nous free tier', () => {
  renderNotices()
  expect(screen.queryByRole('region')).toBeNull()

  act(() => $freeTierRoute.set(false))
  expect(screen.queryByRole('region')).toBeNull()

  act(() => $freeTierRoute.set(true))
  expect(screen.getByRole('region')).toBeTruthy()

  act(() => $freeTierRoute.set(false))
  expect(screen.queryByRole('region')).toBeNull()

  act(() => $freeTierRoute.set(true))
  expect(screen.getByRole('region')).toBeTruthy()

  act(() => $freeTierStatus.set({ ...availableFreeTier, available: false }))
  expect(screen.queryByRole('region')).toBeNull()

  act(() => $freeTierStatus.set(null))
  expect(screen.queryByRole('region')).toBeNull()

  act(() => $freeTierStatus.set(availableFreeTier))
  expect(screen.getByRole('region')).toBeTruthy()

  act(() => $freeTierRoute.set(null))
  expect(screen.queryByRole('region')).toBeNull()
})

it('identifies the provider of the linked policies and leaves unrelated notices intact when its route ends', () => {
  $freeTierRoute.set(true)
  const view = renderNotices('zh')

  expect(screen.getByRole('region').textContent).toBe('使用 Nous 免费服务即表示受其服务条款和隐私政策约束。')
  expect(screen.getByRole('link', { name: '服务条款' }).getAttribute('href')).toBe(
    'https://portal.nousresearch.com/terms'
  )
  expect(screen.getByRole('link', { name: '隐私政策' }).getAttribute('href')).toBe(
    'https://portal.nousresearch.com/privacy'
  )
  expect(screen.queryByRole('button', { name: '关闭' })).toBeNull()

  act(() => {
    disposers.push(registerButterbar({ id: 'update-notice', node: 'Update available' }))
    $freeTierRoute.set(false)
  })
  expect(screen.getByRole('region').textContent).toBe('Update available')

  view.unmount()
  render(<Butterbar />)
  expect(screen.getByRole('region').textContent).toBe('Update available')
})
