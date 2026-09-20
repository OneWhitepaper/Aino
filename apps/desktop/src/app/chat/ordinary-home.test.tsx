import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { $composerDraft } from '@/store/composer'
import { $activeGatewayConnectionId } from '@/store/gateway'
import { $newChatConnectionId, $newChatProfile, $newChatRoute } from '@/store/profile'

import { OrdinaryHome } from './ordinary-home'
import type * as OrdinaryNew from './ordinary-new'
import { $ordinaryHomeReady } from './ordinary-new'
const resolveKind = vi.hoisted(() => vi.fn())
vi.mock('./ordinary-new', async original => ({
  ...(await original<typeof OrdinaryNew>()),
  ordinaryNewKind: resolveKind
}))
afterEach(() => {
  cleanup()
  $ordinaryHomeReady.set(false)
  $newChatRoute.set(null)
  $newChatProfile.set(null)
  $newChatConnectionId.set(null)
  $composerDraft.set('')
  vi.clearAllMocks()
})

const view = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<OrdinaryHome legacy={<div>Legacy draft</div>} />} index />
        <Route element={<div>Managed draft</div>} path="/conversations/new" />
      </Routes>
    </MemoryRouter>
  )

it('waits for restoration and preserves an explicit profile intent arriving during capability discovery', async () => {
  $activeGatewayConnectionId.set('remote')
  let done!: (kind: string) => void
  resolveKind.mockReturnValue(
    new Promise(resolve => {
      done = resolve
    })
  )
  view()
  expect(resolveKind).not.toHaveBeenCalled()
  act(() => $ordinaryHomeReady.set(true))
  await waitFor(() => expect(resolveKind).toHaveBeenCalledWith('remote'))
  act(() => $newChatRoute.set({ connectionId: 'remote', profile: 'writer' }))
  await act(async () => {
    done('conversation')
    await Promise.resolve()
  })
  expect(screen.getByText('Legacy draft')).toBeTruthy()
  expect(screen.queryByText('Managed draft')).toBeNull()
})
it('chooses managed home on positive capability and original home on confirmed older backend', async () => {
  $activeGatewayConnectionId.set('remote')
  $ordinaryHomeReady.set(true)
  resolveKind.mockResolvedValue('conversation')
  const first = view()
  expect(await screen.findByText('Managed draft')).toBeTruthy()
  first.unmount()
  resolveKind.mockResolvedValue('legacy_session')
  view()
  expect(await screen.findByText('Legacy draft')).toBeTruthy()
})
