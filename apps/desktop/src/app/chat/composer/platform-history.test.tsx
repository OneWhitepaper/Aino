import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { useModelControls } from '@/app/session/hooks/use-model-controls'
import { I18nProvider } from '@/i18n'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $freshSessionRequest } from '@/store/profile'
import { $activeSessionId } from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import { platformSnapshot } from '@/test/platform-model'

import type { PlatformAccountSnapshot } from '../../../../shared/platform-contract'

import { PlatformHistoryNotice, usePlatformSessionAccess } from './platform-history'

afterEach(() => {
  cleanup()
  $sessionStates.set({})
  $activeSessionId.set(null)
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('rejects an overlay model change on same-user history from another platform before staging any config', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot('user-a'),
        capabilities: async () => ({}),
        onChanged: () => () => {}
      },
      platformModels: {
        list: async () => [],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()

  const history = {
    ...createClientSessionState('stored-a'),
    provider: 'aino',
    model: 'catalog-a',
    platformModel: {
      ownerUserId: 'user-a',
      platformOrigin: 'http://127.0.0.1:7002',
      modelId: 'catalog-a',
      status: 'ready' as const
    }
  }

  $sessionStates.set({ 'runtime-a': history })
  $activeSessionId.set('runtime-a')
  const request = vi.fn().mockResolvedValue({})
  const { result } = renderHook(() => useModelControls({ queryClient: new QueryClient(), requestGateway: request }))
  let applied: boolean | undefined
  await act(async () => {
    applied = await result.current.selectModel({ model: 'byok-model', provider: 'custom:mine' })
  })
  expect(applied).toBe(false)
  expect(request).not.toHaveBeenCalled()
  expect($sessionStates.get()['runtime-a']).toBe(history)
})

it.each(['en', 'zh'] as const)('keeps foreign history read-only without exposing account IDs (%s)', async locale => {
  let changed!: (snapshot: PlatformAccountSnapshot) => void
  let ownerUserId = 'user-b'
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot('user-b'),
        capabilities: async () => ({}),
        onChanged: (listener: typeof changed) => {
          changed = listener

          return () => {}
        }
      },
      platformModels: {
        list: async () => [],
        owner: async () => ({ user_id: ownerUserId, platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()

  const history = {
    ...createClientSessionState('stored-a'),
    provider: 'aino',
    model: 'catalog-a',
    platformModel: {
      ownerUserId: '10',
      platformOrigin: 'http://127.0.0.1:7001',
      modelId: 'catalog-a',
      status: 'ready' as const
    }
  }

  $sessionStates.set({ 'runtime-a': history })

  function History() {
    const access = usePlatformSessionAccess('runtime-a')
    const owner = access.kind === 'foreign' ? access.ownerUserId : null

    return (
      <>
        <button disabled={access.kind !== 'allowed'}>Send</button>
        {owner !== null && <PlatformHistoryNotice ownerUserId={owner} />}
      </>
    )
  }

  render(
    <I18nProvider configClient={null} initialLocale={locale}>
      <History />
    </I18nProvider>
  )
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull())
  expect(screen.getByRole('status').textContent).not.toContain('10')
  const prior = $freshSessionRequest.get()
  fireEvent.click(screen.getByRole('button', { name: locale === 'zh' ? /新建会话/ : /New chat/ }))
  expect($freshSessionRequest.get()).toBe(prior + 1)
  expect($sessionStates.get()['runtime-a']).toBe(history)
  ownerUserId = '10'
  act(() => changed(platformSnapshot('10', 2)))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.queryByRole('status')).toBeNull()
})
