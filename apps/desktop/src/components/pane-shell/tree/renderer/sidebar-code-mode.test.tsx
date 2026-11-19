import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import {
  $currentExecutionMode,
  $executionModeRequest,
  getDraftExecutionMode,
  setDraftExecutionMode
} from '@/store/execution-mode'
import { $freshSessionRequest } from '@/store/profile'
import { $selectedStoredSessionId, $sessions } from '@/store/session'

import { SidebarModeHeader } from './sidebar-mode-header'

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  $sessions.set([])
  $selectedStoredSessionId.set(null)
  setDraftExecutionMode('work')
})

afterEach(cleanup)

it('offers Work and Code from the brand while keeping session search in the same shell', async () => {
  $selectedStoredSessionId.set('old-work')
  const before = $freshSessionRequest.get()
  render(
    <SidebarModeHeader
      activeId="sessions"
      items={[{ id: 'sessions', title: 'Aino' }]}
      menuLabel="Switch mode"
      navigation="rail"
      onSelect={vi.fn()}
    />
  )

  fireEvent.keyDown(screen.getByRole('button', { name: 'Switch Aino mode: Aino Work' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Aino Code/ }))

  expect($freshSessionRequest.get()).toBe(before)
  expect($executionModeRequest.get()).toMatchObject({ mode: 'code' })
  expect($selectedStoredSessionId.get()).toBe('old-work')
  expect($currentExecutionMode.get()).toBe('work')
  expect(getDraftExecutionMode()).toBe('work')
  expect(screen.getByRole('button', { name: 'Search sessions' })).toBeTruthy()
})
