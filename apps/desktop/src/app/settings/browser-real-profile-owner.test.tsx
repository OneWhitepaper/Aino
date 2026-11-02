// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HermesApi from '@/hermes'
import { bindConfigReadOrigin, getHermesConfigRecord, saveHermesConfigRecord } from '@/hermes'
import { queryClient } from '@/lib/query-client'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $realProfilePromptClaim,
  $realProfilePromptDismissed,
  $realProfilePromptMuted
} from '@/store/real-profile-consent'
import { $connection } from '@/store/session'

import { RealProfileConsentDialog } from '../chat/right-rail/real-profile-consent-dialog'
import { hermesConfigKey } from '../hooks/use-config-record'

import { BrowserRealProfilePanel } from './browser-real-profile-panel'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof HermesApi>()),
  getHermesConfigRecord: vi.fn(),
  saveHermesConfigRecord: vi.fn()
}))
vi.mock('@/store/notifications', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notify: vi.fn(),
  notifyError: vi.fn()
}))

const laptop = { browser: { use_real_profile: false, allow_private_urls: false } }
const devbox = { browser: { use_real_profile: true, allow_private_urls: true } }

beforeEach(() => {
  queryClient.clear()
  $activeGatewayProfile.set('default')
  $connection.set({ connectionId: 'laptop', mode: 'local' } as never)
  $realProfilePromptClaim.set(null)
  $realProfilePromptDismissed.set(false)
  $realProfilePromptMuted.set(false)
  bindConfigReadOrigin(laptop, { connectionId: 'laptop', profile: 'default' })
  bindConfigReadOrigin(devbox, { connectionId: 'devbox', profile: 'default' })
  vi.mocked(getHermesConfigRecord).mockImplementation(() =>
    Promise.resolve($connection.get()?.connectionId === 'devbox' ? devbox : laptop)
  )
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  $connection.set(null)
  $activeGatewayProfile.set('default')
  $realProfilePromptClaim.set(null)
  $realProfilePromptMuted.set(false)
  vi.clearAllMocks()
})

describe('real-profile save ownership', () => {
  for (const surface of ['panel', 'consent'] as const) {
    it('keeps a delayed ' + surface + ' rollback on the gateway that supplied its config', async () => {
      let rejectSave!: (error: Error) => void
      vi.mocked(saveHermesConfigRecord).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectSave = reject
          })
      )

      render(
        <QueryClientProvider client={queryClient}>
          {surface === 'panel' ? <BrowserRealProfilePanel /> : <RealProfileConsentDialog tabId="browser-1" />}
        </QueryClientProvider>
      )

      if (surface === 'panel') {
        const toggle = await screen.findByRole('switch')
        await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
        fireEvent.click(toggle)
      } else {
        const button = await screen.findByRole('button', { name: 'Use my profile' })
        fireEvent.click(button)
      }

      await waitFor(() => expect(saveHermesConfigRecord).toHaveBeenCalledOnce())

      act(() => $connection.set({ connectionId: 'devbox', mode: 'remote' } as never))
      await waitFor(() => expect(queryClient.getQueryData(hermesConfigKey(undefined, 'devbox'))).toEqual(devbox))
      await act(async () => rejectSave(new Error('old gateway save failed')))

      expect(queryClient.getQueryData(hermesConfigKey(undefined, 'devbox'))).toEqual(devbox)
    })

    it.each(['connection', 'profile'] as const)(
      'keeps a new ' + surface + ' %s save busy when the previous owner fails',
      async owner => {
        let failOldSave!: (error: Error) => void
        let finishNewSave!: (value: { ok: boolean }) => void
        const nextConfig = { browser: { use_real_profile: false, allow_private_urls: true } }
        vi.mocked(saveHermesConfigRecord)
          .mockImplementationOnce(
            () =>
              new Promise((_resolve, reject) => {
                failOldSave = reject
              })
          )
          .mockImplementationOnce(
            () =>
              new Promise(resolve => {
                finishNewSave = resolve
              })
          )

        render(
          <QueryClientProvider client={queryClient}>
            {surface === 'panel' ? <BrowserRealProfilePanel /> : <RealProfileConsentDialog tabId="browser-1" />}
          </QueryClientProvider>
        )

        const getControl = () =>
          surface === 'panel' ? screen.getByRole('switch') : screen.getByRole('button', { name: 'Use my profile' })

        await waitFor(() => expect(getControl().hasAttribute('disabled')).toBe(false))
        fireEvent.click(getControl())
        await waitFor(() => expect(saveHermesConfigRecord).toHaveBeenCalledOnce())

        const nextConnection = owner === 'connection' ? 'devbox' : 'laptop'
        const nextProfile = owner === 'profile' ? 'other-profile' : 'default'
        bindConfigReadOrigin(nextConfig, { connectionId: nextConnection, profile: nextProfile })
        vi.mocked(getHermesConfigRecord).mockResolvedValue(nextConfig)
        act(() => {
          if (owner === 'connection') {
            $connection.set({ connectionId: nextConnection, mode: 'local' } as never)
          } else {
            $activeGatewayProfile.set(nextProfile)
          }

          queryClient.setQueryData(hermesConfigKey(undefined, nextConnection), nextConfig)
        })
        await waitFor(() => expect(getControl().hasAttribute('disabled')).toBe(false))
        fireEvent.click(getControl())
        await waitFor(() => expect(saveHermesConfigRecord).toHaveBeenCalledTimes(2))
        await act(async () => failOldSave(new Error('previous owner save failed')))

        expect(queryClient.getQueryData(hermesConfigKey(undefined, nextConnection))).toEqual({
          browser: { allow_private_urls: true, use_real_profile: true }
        })

        if (surface === 'panel') {
          expect(getControl().hasAttribute('disabled')).toBe(true)
        }

        await act(async () => finishNewSave({ ok: true }))

        if (surface === 'panel') {
          expect(getControl().hasAttribute('disabled')).toBe(false)
        }
      }
    )
  }
})
