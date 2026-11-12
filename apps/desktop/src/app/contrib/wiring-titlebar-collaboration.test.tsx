import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { Slot } from '@/contrib/react/slot'
import { $collaborationCapsuleOpen, openCollaborationCapsule } from '@/store/collaboration-capsule-view'

const fixture = vi.hoisted(() => ({ role: 'main' }))

vi.mock('../agents/collaboration-capsule', async () => {
  const { useStore } = await import('@nanostores/react')
  const { $collaborationCapsuleOpen } = await import('@/store/collaboration-capsule-view')

  return {
    CollaborationCapsule: ({ autoVisible }: { autoVisible: boolean }) => {
      const open = useStore($collaborationCapsuleOpen)

      return (
        <button data-testid="capsule-owner" hidden={!autoVisible && !open} type="button">
          Collaboration capsule
        </button>
      )
    }
  }
})
vi.mock('@/store/windows', () => ({
  isAuxiliaryWindow: () => fixture.role !== 'main',
  isSecondaryWindow: () => fixture.role === 'secondary',
  isHudWindow: () => fixture.role === 'hud',
  isBrowserWindow: () => fixture.role === 'browser'
}))
vi.mock('../shell/titlebar-controls', () => ({ TitlebarControls: () => null }))
vi.mock('../shell/wslg-window-controls', () => ({ WslgWindowControls: () => null }))
vi.mock('../shell/use-touch-titlebar', () => ({ useTouchTitlebar: () => false }))
vi.mock('../shell/hooks/use-window-controls-overlay-width', () => ({ useWindowControlsOverlayWidth: () => 0 }))
vi.mock('./panes', () => ({ useTitlebarToolContributions: () => [] }))

import { WiringTitlebar } from './wiring-titlebar'

function WorkspaceNavigation() {
  const navigate = useNavigate()

  return (
    <>
      <button onClick={() => navigate('/settings')} type="button">
        settings
      </button>
      <button onClick={() => navigate('/stored-chat')} type="button">
        chat
      </button>
    </>
  )
}

function shell(path = '/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <WiringTitlebar>
        <Slot area="titleBar.center" />
        <WorkspaceNavigation />
      </WiringTitlebar>
    </MemoryRouter>
  )
}

beforeEach(() => {
  fixture.role = 'main'
  $workspaceMode.set('sessions')
  $collaborationCapsuleOpen.set(false)
})
afterEach(() => cleanup())

describe('workspace collaboration titlebar slot', () => {
  it.each(['sessions', 'bots'] as const)('mounts a single capsule in the %s workspace', mode => {
    $workspaceMode.set(mode)
    render(shell('/stored-chat'))

    expect(screen.getAllByRole('button', { name: 'Collaboration capsule' })).toHaveLength(1)
  })

  it.each(['hud', 'browser', 'secondary'])('does not add main-window chrome to the %s surface', role => {
    fixture.role = role
    render(shell('/stored-chat'))

    expect(screen.queryByRole('button', { name: 'Collaboration capsule' })).toBeNull()
  })

  it('keeps inactive chat collaboration out of settings', () => {
    render(shell('/settings'))

    expect(screen.queryByRole('button', { name: 'Collaboration capsule' })).toBeNull()
    const owner = screen.getByTestId('capsule-owner')
    act(() => openCollaborationCapsule())
    expect(screen.getByRole('button', { name: 'Collaboration capsule' })).toBeTruthy()
    expect(screen.getByTestId('capsule-owner')).toBe(owner)
  })

  it('retains one capsule owner while navigating through settings and back', () => {
    render(shell('/stored-chat'))
    const owner = screen.getByTestId('capsule-owner')

    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    expect(screen.queryByRole('button', { name: 'Collaboration capsule' })).toBeNull()
    expect(screen.getByTestId('capsule-owner')).toBe(owner)
    fireEvent.click(screen.getByRole('button', { name: 'chat' }))
    expect(screen.getByRole('button', { name: 'Collaboration capsule' })).toBe(owner)
  })
})
