import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import type { HermesRepoStatus } from '@/global'
import { $revealInTreeRequest } from '@/store/layout'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $projectTree, $startWorkSessionRequest } from '@/store/projects'
import {
  $activeSessionId,
  $connection,
  $currentCwd,
  $messages,
  $newChatWorkspaceTarget,
  $selectedStoredSessionId,
  $sessions
} from '@/store/session'

const repoStatus = atom<HermesRepoStatus | null>(null)
const desktop = window.hermesDesktop

vi.mock('@/store/coding-status', () => ({
  registerRepoStatusCwd: () => undefined,
  repoStatusForCwd: () => repoStatus,
  repoWorktreesForCwd: () => atom([])
}))

const { CodingStatusRow } = await import('./coding-row')

describe('CodingStatusRow', () => {
  beforeEach(() => {
    repoStatus.set({
      added: 12,
      ahead: 0,
      behind: 0,
      branch: 'bb/hitbox',
      defaultBranch: 'main',
      detached: false,
      staged: 1,
      unstaged: 2,
      conflicted: 0,
      changed: 3,
      files: [],
      removed: 3,
      untracked: 0
    })
    $projectTree.set([
      { id: 'p_repo', label: 'My project', path: '/repo', repos: [], sessionCount: 0 },
      { id: 'p_other', label: 'Other project', path: '/Users/someone/www/repo', repos: [], sessionCount: 0 },
      {
        id: '/auto-project',
        label: 'Discovered project',
        path: '/auto-project',
        repos: [],
        sessionCount: 0,
        isAuto: true
      },
      { id: 'home', label: 'No project', path: '/ordinary-chat', repos: [], sessionCount: 0, isNoProject: true }
    ])
    $startWorkSessionRequest.set(null)
    $activeSessionId.set(null)
    $connection.set(null)
    $sessions.set([])
    $selectedStoredSessionId.set(null)
    $messages.set([])
    $currentCwd.set('')
    $newChatWorkspaceTarget.set(null)
    $revealInTreeRequest.set(null)
    window.hermesDesktop = desktop
  })
  afterEach(() => {
    cleanup()
    $projectTree.set([])
    $startWorkSessionRequest.set(null)
    $selectedStoredSessionId.set(null)
    $connection.set(null)
    $sessions.set([])
    $messages.set([])
    $revealInTreeRequest.set(null)
    window.hermesDesktop = desktop
    clearNotifications()
  })

  it('offers project selection instead of incidental git details for an ordinary chat', () => {
    render(<CodingStatusRow repoPath="/ordinary-chat" />)
    expect(screen.queryByText('bb/hitbox')).toBeNull()
    expect(screen.queryByText('12')).toBeNull()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Select project' }), { button: 0, ctrlKey: false })
    expect(screen.queryByRole('menuitem', { name: 'Copy path' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'My project' }))
    expect($newChatWorkspaceTarget.get()).toBe('/repo')
    expect($currentCwd.get()).toBe('/repo')
    expect($startWorkSessionRequest.get()).toBeNull()
  })

  it('opens a separate project chat for a stored conversation without changing its directory', () => {
    $selectedStoredSessionId.set('existing-chat')
    $currentCwd.set('/original')
    render(<CodingStatusRow repoPath="/original" />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Select project' }), { button: 0, ctrlKey: false })
    expect(screen.getByText('Start a new chat in project')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'My project' }))

    expect($startWorkSessionRequest.get()).toMatchObject({ path: '/repo', openTab: true })
    expect($currentCwd.get()).toBe('/original')
    expect($selectedStoredSessionId.get()).toBe('existing-chat')
  })

  it.each([
    [true, '/repo/src'],
    [false, '/repo/src'],
    [true, '']
  ] as const)(
    'limits an existing project conversation to its own directory actions (git: %s, live cwd: %s)',
    (git, liveCwd) => {
      if (!git) {
        repoStatus.set(null)
      }

      $selectedStoredSessionId.set('existing-project-chat')
      $currentCwd.set(liveCwd || '/auto-project')
      render(<CodingStatusRow repoPath={liveCwd} />)
      act(() => {
        $sessions.set([
          {
            id: 'project-chat-tip',
            _lineage_root_id: 'existing-project-chat',
            cwd: '/repo/src',
            profile: 'default'
          } as ReturnType<typeof $sessions.get>[number]
        ])
      })

      if (!liveCwd) {
        expect(screen.queryByText('bb/hitbox')).toBeNull()
      }

      fireEvent.pointerDown(screen.getByRole('button', { name: 'My project' }), { button: 0 })

      expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
      expect(screen.getByRole('menuitem', { name: 'Reveal in filetree' })).toBeTruthy()
      expect(screen.queryByRole('menuitem', { name: 'Other project' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Discovered project' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'New project' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Open folder as project…' })).toBeNull()
      fireEvent.click(screen.getByRole('menuitem', { name: 'New session in My project' }))

      expect($startWorkSessionRequest.get()).toMatchObject({ path: '/repo/src', openTab: true })
      expect($selectedStoredSessionId.get()).toBe('existing-project-chat')
      expect($currentCwd.get()).toBe(liveCwd || '/auto-project')
    }
  )

  it('uses the tile project menu even when the primary composer is an unsent draft in another project', () => {
    $currentCwd.set('/repo')
    const tileCwd = '/Users/someone/www/repo'

    const view = {
      ...PRIMARY_SESSION_VIEW,
      kind: 'tile' as const,
      $runtimeId: atom<string | null>(null),
      $storedId: atom<string | null>('tile-chat'),
      $cwd: atom(tileCwd),
      $busy: atom(false),
      $messagesEmpty: atom(true)
    }

    render(
      <SessionViewProvider value={view}>
        <CodingStatusRow repoPath={tileCwd} />
      </SessionViewProvider>
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Other project' }), { button: 0 })

    expect(screen.queryByRole('menuitem', { name: 'My project' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New session in Other project' }))
    expect($startWorkSessionRequest.get()).toMatchObject({ path: tileCwd, openTab: true })
    expect($currentCwd.get()).toBe('/repo')

    act(() => {
      $startWorkSessionRequest.set(null)
      $sessions.set([{ id: 'tile-chat', profile: 'default' } as ReturnType<typeof $sessions.get>[number]])
      $connection.set({ mode: 'remote', connectionId: 'other-host', profile: 'default' } as NonNullable<
        ReturnType<typeof $connection.get>
      >)
    })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Other project' }), { button: 0 })
    const newChat = screen.getByRole('menuitem', { name: 'New session in Other project' })

    expect(newChat.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Reveal in filetree' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Open containing folder' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Copy path' }).getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(newChat)
    expect($startWorkSessionRequest.get()).toBeNull()

    act(() => {
      $sessions.set([
        {
          id: 'tile-chat',
          profile: 'default',
          connection_id: 'other-host',
          cwd: tileCwd
        } as ReturnType<typeof $sessions.get>[number]
      ])
    })
    expect(newChat.getAttribute('aria-disabled')).not.toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Reveal in filetree' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  it('shows the project with its branch and keeps the project reachable outside git', () => {
    $selectedStoredSessionId.set('existing-project-chat')
    $sessions.set([{ id: 'existing-project-chat', cwd: '/repo' } as ReturnType<typeof $sessions.get>[number]])
    const { rerender } = render(<CodingStatusRow repoPath="/repo" />)
    expect(screen.getByText('My project')).toBeTruthy()
    expect(screen.getByText('bb/hitbox')).toBeTruthy()

    rerender(<CodingStatusRow repoPath="/auto-project" />)
    expect(screen.getByText('Discovered project')).toBeTruthy()
    expect(screen.getByText('bb/hitbox')).toBeTruthy()

    act(() => repoStatus.set(null))
    rerender(<CodingStatusRow repoPath="/repo" />)
    expect(screen.getByRole('button', { name: 'My project' })).toBeTruthy()
    expect(screen.queryByText('bb/hitbox')).toBeNull()

    rerender(<CodingStatusRow repoPath="/outside-projects" />)
    expect(screen.getByRole('button', { name: 'Select project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'My project' })).toBeNull()
  })

  it('opens the review pane from the branch and the diff counts, never the bar itself', () => {
    const onOpen = vi.fn()

    const { container } = render(<CodingStatusRow onOpen={onOpen} repoPath="/repo" />)

    const bar = container.querySelector<HTMLElement>('.coding-status-bar')

    expect(bar).not.toBeNull()

    fireEvent.click(bar!)
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('bb/hitbox'))
    expect(onOpen).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('12'))
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('wraps the click targets without adding a layout box', () => {
    const { container } = render(<CodingStatusRow onOpen={() => undefined} repoPath="/repo" />)

    // `display: contents` is what keeps the branch label and the counts direct
    // flex children of the row — the hit areas cost nothing visually.
    expect(screen.getByText('bb/hitbox').parentElement?.classList.contains('contents')).toBe(true)
    expect(screen.getByText('12').closest('button')?.classList.contains('contents')).toBe(true)
    // The glyph button fills the row's existing 3.5 leading slot exactly.
    expect(container.querySelector('button[class~="size-3.5"]')).not.toBeNull()
  })

  it('parks the copy glyph against the end of the path, not the end of the row', () => {
    render(<CodingStatusRow onOpen={() => undefined} repoPath="/Users/someone/www/repo" />)

    const path = screen.getByText('~/www/repo')

    // The path sizes to its content and the glyph is its immediate sibling, so
    // the pair reads as one unit. `flex-1` belongs to the wrapper (which holds
    // the row's slack open) — on the label it stretched the text and pushed the
    // glyph out to the kebab.
    expect(path.classList.contains('flex-1')).toBe(false)
    expect(path.parentElement?.classList.contains('flex-1')).toBe(true)
    expect(path.nextElementSibling?.tagName).toBe('BUTTON')
  })

  it('copies the absolute cwd inline — checkmark feedback, no toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    clearNotifications()

    render(<CodingStatusRow onOpen={() => undefined} repoPath="/Users/someone/www/repo" />)

    // Painted tildified, copied raw.
    expect(screen.getByText('~/www/repo')).toBeTruthy()

    const copy = screen.getByRole('button', { name: 'Copy path' })

    fireEvent.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/Users/someone/www/repo'))
    // Confirmation is the button turning into a checkmark, not a notification.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect($notifications.get()).toHaveLength(0)
  })

  it.each([true, false])('keeps directory actions in the owning project menu (git: %s)', async git => {
    if (!git) {
      repoStatus.set(null)
    }

    const cwd = '/Users/someone/www/repo'
    const revealPath = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    window.hermesDesktop = { ...desktop, revealPath, writeClipboard: writeText } as typeof window.hermesDesktop
    render(<CodingStatusRow repoPath={cwd} />)

    const open = () => fireEvent.pointerDown(screen.getByRole('button', { name: 'Other project' }), { button: 0 })

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(cwd))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open containing folder' }))
    await waitFor(() => expect(revealPath).toHaveBeenCalledWith(cwd))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal in filetree' }))
    expect($revealInTreeRequest.get()).toBe(cwd)
    expect($startWorkSessionRequest.get()).toBeNull()
  })
})
