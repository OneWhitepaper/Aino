import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { $collaborationCapsuleOpen } from '@/store/collaboration-capsule-view'

import { useOverlayRouting } from './use-overlay-routing'

function Probe() {
  const routing = useOverlayRouting()
  const location = useLocation()

  return (
    <>
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => routing.toggleCommandCenter()} type="button">
        toggle
      </button>
      <button onClick={() => routing.openCommandCenterSection('system')} type="button">
        open-system
      </button>
      <button onClick={routing.closeOverlayToPreviousRoute} type="button">
        close
      </button>
      <button onClick={routing.openAgents} type="button">
        collaboration
      </button>
    </>
  )
}

afterEach(() => {
  cleanup()
  $collaborationCapsuleOpen.set(false)
})

describe('useOverlayRouting', () => {
  it('opens collaboration without navigating away from the current conversation', () => {
    render(
      <MemoryRouter initialEntries={['/chat-current']}>
        <Probe />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'collaboration' }))
    expect($collaborationCapsuleOpen.get()).toBe(true)
    expect(screen.getByTestId('route').textContent).toBe('/chat-current')
  })

  it('redirects a legacy monitor URL into the capsule without leaving an overlay', () => {
    render(
      <MemoryRouter initialEntries={['/agents']}>
        <Probe />
      </MemoryRouter>
    )

    expect($collaborationCapsuleOpen.get()).toBe(true)
    expect(screen.getByTestId('route').textContent).toBe('/')
  })

  it('returns to the active settings tab after opening the command center', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=gateway']}>
        <Probe />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open-system' }))
    expect(screen.getByTestId('route').textContent).toBe('/command-center?section=system')

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByTestId('route').textContent).toBe('/settings?tab=gateway')

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByTestId('route').textContent).toBe('/')
  })

  it('keeps the settings return path for the command-center toggle shortcut', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=about']}>
        <Probe />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByTestId('route').textContent).toBe('/command-center')

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByTestId('route').textContent).toBe('/settings?tab=about')
  })
})
