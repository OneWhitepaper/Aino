import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $freeTierStatus } from '@/store/free-tier'
import { $freeTierSignIn } from '@/store/free-tier-sign-in'
import { $modelPickerOpen } from '@/store/session'

import { FreeTierNoticeStrip } from './notice-strip'

const { requestGateway } = vi.hoisted(() => ({ requestGateway: vi.fn() }))
vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({ useGatewayRequest: () => ({ requestGateway }) }))

afterEach(() => {
  cleanup()
  $freeTierStatus.set(null)
  $freeTierSignIn.set({ status: 'closed' })
  $modelPickerOpen.set(false)
  requestGateway.mockReset()
})

it.each(['Open model picker', 'Sign in', 'Dismiss'])(
  'keeps the %s recovery on its existing path and acknowledges the backend notice',
  async label => {
    requestGateway.mockImplementation(async (method: string) =>
      method === 'free_tier.ack_notice' ? { acked: true } : { has_guest: true, notice_pending: false }
    )
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <FreeTierNoticeStrip />
      </I18nProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(requestGateway).toHaveBeenCalledWith('free_tier.ack_notice'))
    await waitFor(() => expect($freeTierStatus.get()?.notice_pending).toBe(false))
    expect($modelPickerOpen.get()).toBe(label === 'Open model picker')
    expect($freeTierSignIn.get().status).toBe(label === 'Sign in' ? 'requested' : 'closed')
  }
)
